// @ts-check
/**
 * Main-process side of the desktop OAuth bridge.
 *
 * Responsibilities:
 *
 *   - Accept `auth:startOAuth` IPC from the renderer, generate a
 *     per-flow UUID `state`, record it as a pending flow, and open
 *     `https://api.playtiao.com/api/auth/desktop/start?provider=X&state=UUID`
 *     in the user's default browser via `shell.openExternal`.
 *
 *   - Receive `tiao://auth/complete?state=...&code=...` callbacks from
 *     the deep-link handler.  Verify `state` matches a pending flow,
 *     POST `{state, code}` to `/api/auth/desktop/exchange`, and on
 *     success persist the returned bearer token via `safeStorage` and
 *     broadcast an `auth:complete` IPC to the main BrowserWindow.
 *
 *   - Read / write / clear the persisted token on disk under
 *     `app.getPath("userData")/tiao-desktop-auth.enc`.  `safeStorage`
 *     wraps the platform keychain (macOS Keychain, Windows DPAPI,
 *     Linux libsecret) so the token-at-rest is encrypted by the OS.
 *     Steam builds keep tokens in memory and reauthenticate through Steam.
 *
 *   - Expose `auth:getToken` / `auth:logout` IPC so AuthContext can
 *     rehydrate on launch and flush on logout.
 *
 * Error paths bounce the renderer with `auth:error` events carrying
 * a short reason string so the toast UI can surface it.  State TTL
 * is 5 minutes — anything older gets discarded.
 */

const { app, ipcMain, shell, safeStorage, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { randomUUID, randomBytes, createHash } = require("node:crypto");
const { captureException: captureGlitchtipException } = require("./glitchtip.cjs");
const { resolveApiUrl } = require("./config.cjs");
const { DISTRIBUTION_CHANNEL } = require("./distribution.cjs");

// Steam verifies the active player and issues a fresh session on each launch.
// Never read or write OS credentials, including legacy tokens, in Steam builds.
const PERSIST_TOKEN = DISTRIBUTION_CHANNEL !== "steam";

const { handleTrustedIpc, isTrustedContents, isSafeExternalUrl } = require("./trust.cjs");

const TOKEN_FILE = "tiao-desktop-auth.enc";
const STATE_TTL_MS = 5 * 60 * 1000;

/**
 * In-memory table of pending OAuth flows.  Each entry is keyed by
 * the server-facing `state` UUID we generated in `startOAuth`.
 * Expires after STATE_TTL_MS.
 *
 * @type {Map<string, { provider: string; createdAt: number; verifier?: string; timer?: NodeJS.Timeout; linkSteam?: boolean }>}
 */
const pendingAuth = new Map();

let authGeneration = 0;
/** In-memory cache of the current session token (or null). */
let cachedToken = /** @type {string | null} */ (null);
/** @type {{ getTicket: () => Promise<{ ticket: string; cancel: () => void } | null>; appId: number } | null} */
let nativeSteam = null;
/** Kept in the main process until the player confirms the destination by name. */
let pendingSteamLink =
  /** @type {{ token: string; displayName: string; createdAt: number } | null} */ (null);

async function stageSteamLink(/** @type {string} */ token, generation = authGeneration) {
  if (!nativeSteam) throw new Error("Open the Steam build to link a Steam account.");
  const response = await fetch(`${resolveApiUrl()}/api/player/me`, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  const body = /** @type {{ player?: { kind?: string; displayName?: string } }} */ (
    await response.json()
  );
  if (!response.ok || body.player?.kind !== "account" || !body.player.displayName)
    throw new Error("Could not verify the web account.");
  if (generation !== authGeneration) {
    await revokeToken(token);
    throw new Error("Sign-in cancelled.");
  }
  if (pendingSteamLink) await revokeToken(pendingSteamLink.token).catch(() => {});
  pendingSteamLink = { token, displayName: body.player.displayName, createdAt: Date.now() };
  broadcastToRenderer("auth:steamLinkReady", { displayName: body.player.displayName });
}

function cancelOAuth() {
  for (const pending of pendingAuth.values()) clearTimeout(pending.timer);
  pendingAuth.clear();
}

/** Link a proven web login to the active Steam player before replacing the app identity. */
async function linkActiveSteam(/** @type {string} */ token) {
  if (!nativeSteam) return token;
  const ticket = await nativeSteam.getTicket();
  if (!ticket) throw new Error("Steam is unavailable. Open Steam and try again.");
  const response = await fetch(`${resolveApiUrl()}/api/auth/steam/session`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: "link", ticket: ticket.ticket, appId: nativeSteam.appId }),
  }).finally(() => ticket.cancel());
  const result = /** @type {{ sessionToken?: string; message?: string }} */ (await response.json());
  if (!response.ok || typeof result.sessionToken !== "string")
    throw new Error(result.message || "Could not link your existing account.");
  return result.sessionToken;
}

/** Poll with a secret that never enters the browser URL. Deep links remain a fast path. */
function schedulePoll(/** @type {string} */ state) {
  const pending = pendingAuth.get(state);
  if (!pending?.verifier) return;
  pending.timer = setTimeout(async () => {
    if (pendingAuth.get(state) !== pending) return;
    if (Date.now() - pending.createdAt > STATE_TTL_MS) {
      pendingAuth.delete(state);
      broadcastToRenderer("auth:error", { reason: "expired" });
      return;
    }
    try {
      const response = await fetch(`${resolveApiUrl()}/api/auth/desktop/poll`, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, code_verifier: pending.verifier }),
      });
      if (response.ok && response.status !== 202) {
        const result = /** @type {{ code?: string; reason?: string }} */ (await response.json());
        if (result.reason) {
          await handleAuthDeepLink(
            new URL(
              `tiao://auth/error?state=${encodeURIComponent(state)}&reason=${encodeURIComponent(result.reason)}`,
            ),
          );
          return;
        }
        if (result.code) {
          await handleAuthDeepLink(
            new URL(
              `tiao://auth/complete?state=${encodeURIComponent(state)}&code=${encodeURIComponent(result.code)}`,
            ),
          );
          return;
        }
      }
    } catch {
      /* Transient network loss: retry within the bounded sign-in window. */
    }
    schedulePoll(state);
  }, 2500);
  pending.timer.unref?.();
}

/**
 * Return the absolute path to the encrypted token file under the
 * per-user Electron data directory.  Computed lazily so unit tests
 * can patch `app.getPath`.
 */
function getTokenFilePath() {
  return path.join(app.getPath("userData"), TOKEN_FILE);
}

/**
 * Persist an encrypted bearer token.  No-op when safeStorage is
 * unavailable (Linux without libsecret, some dev containers).  In
 * that case we still keep the token in-memory for the current
 * session — persistence across restarts just doesn't work.
 *
 * @param {string} token
 */
function persistToken(token) {
  cachedToken = token;
  if (!PERSIST_TOKEN) return;
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn("[authBridge] safeStorage unavailable — token will not survive app restart.");
    return;
  }
  try {
    const encrypted = safeStorage.encryptString(token);
    fs.writeFileSync(getTokenFilePath(), encrypted, { mode: 0o600 });
  } catch (err) {
    console.error("[authBridge] failed to persist encrypted token:", err);
    captureGlitchtipException(err, { location: "authBridge.persistToken" });
  }
}

/**
 * Load the persisted token on app startup.  Called explicitly by
 * main.cjs before the first IPC handler fires so AuthContext sees
 * a warm cache immediately.
 *
 * If safeStorage is unavailable but an encrypted file already exists
 * on disk (e.g. the user previously had libsecret installed and then
 * uninstalled it), warn — the user is silently being signed out and
 * deserves to know why.
 */
function loadPersistedToken() {
  if (!PERSIST_TOKEN) return;
  try {
    const file = getTokenFilePath();
    if (!fs.existsSync(file)) return;
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn(
        "[authBridge] safeStorage unavailable — cannot decrypt persisted token. User will be signed out.",
      );
      return;
    }
    const encrypted = fs.readFileSync(file);
    const decrypted = safeStorage.decryptString(encrypted);
    if (decrypted) cachedToken = decrypted;
  } catch (err) {
    console.error("[authBridge] failed to load persisted token:", err);
  }
}

/**
 * Returns whether OS-level credential encryption is available on this
 * machine.  Wraps `safeStorage.isEncryptionAvailable()` so the result
 * can be read from outside the module (e.g. by an IPC handler that
 * surfaces the status to the renderer).
 *
 * False on:
 *   - Linux without libsecret-1-0 / gnome-keyring (very common in
 *     headless / minimal installs)
 *   - Some sandboxed dev container setups
 *   - Older macOS releases where Keychain access is denied
 */
function isPersistenceAvailable() {
  if (!PERSIST_TOKEN) return false;
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

/** Wipe the persisted token file and clear the in-memory cache. */
function clearPersistedToken() {
  cachedToken = null;
  try {
    const file = getTokenFilePath();
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (err) {
    console.error("[authBridge] failed to clear persisted token:", err);
  }
}

/**
 * Drop any pending OAuth flows that have outlived the TTL.  Called
 * on every state lookup so the table stays bounded even if users
 * repeatedly start and cancel flows.
 */
function evictStaleFlows() {
  const now = Date.now();
  for (const [state, entry] of pendingAuth) {
    if (now - entry.createdAt > STATE_TTL_MS) pendingAuth.delete(state);
  }
}

/**
 * Entry point for a fresh desktop OAuth flow.  Generates state,
 * records it as pending, opens the system browser.
 *
 * @param {string} provider
 */
async function startOAuth(provider, linkSteam = false) {
  cancelOAuth();
  evictStaleFlows();
  const state = randomUUID();
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  pendingAuth.set(state, { provider, createdAt: Date.now(), verifier, linkSteam });
  const url = `${resolveApiUrl()}/api/auth/desktop/start?provider=${encodeURIComponent(
    provider,
  )}&state=${encodeURIComponent(state)}&code_challenge=${challenge}&code_challenge_method=S256`;
  if (!isSafeExternalUrl(url)) throw new Error("Unsafe OAuth URL");
  try {
    await shell.openExternal(url);
    schedulePoll(state);
  } catch (error) {
    pendingAuth.delete(state);
    throw error;
  }
}

/**
 * Find the first main BrowserWindow (if any) and send an IPC
 * event to its renderer.  Used to notify AuthContext of auth:complete
 * / auth:error.
 *
 * @param {string} channel
 * @param {unknown} payload
 */
function broadcastToRenderer(channel, payload) {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!isTrustedContents(win.webContents)) continue;
    try {
      win.webContents.send(channel, payload);
    } catch (err) {
      console.error(`[authBridge] failed to send ${channel} to window:`, err);
    }
  }
}

/**
 * Handle an incoming `tiao://auth/complete?state=X&code=Y` or
 * `tiao://auth/error?state=X&reason=R` deep link from the
 * deepLink module.  Verifies state, exchanges code for a token,
 * persists, and notifies the renderer.
 *
 * @param {URL} parsedUrl
 */
async function handleAuthDeepLink(parsedUrl) {
  if (parsedUrl.protocol !== "tiao:" || parsedUrl.username || parsedUrl.password || parsedUrl.port)
    return;
  const kind =
    parsedUrl.host === "auth"
      ? `auth${parsedUrl.pathname}`
      : parsedUrl.host === ""
        ? parsedUrl.pathname.replace(/^\/+/, "")
        : "";
  if (kind !== "auth/complete" && kind !== "auth/error") return;
  const state = parsedUrl.searchParams.get("state") || "";
  const code = parsedUrl.searchParams.get("code") || "";
  const reason = parsedUrl.searchParams.get("reason") || "unknown";

  evictStaleFlows();
  const pending = pendingAuth.get(state);
  if (!pending) {
    // A deep link can arrive after polling has already completed the same flow.
    return;
  }
  clearTimeout(pending.timer);
  pendingAuth.delete(state);
  const generation = authGeneration;

  if (kind === "auth/error") {
    broadcastToRenderer("auth:error", { reason });
    return;
  }

  if (kind !== "auth/complete" || !code) {
    broadcastToRenderer("auth:error", { reason: "malformed_callback" });
    return;
  }

  try {
    const res = await fetch(`${resolveApiUrl()}/api/auth/desktop/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        state,
        code,
        ...(pending.verifier ? { code_verifier: pending.verifier } : {}),
      }),
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    });
    if (!res.ok) {
      console.warn(`[authBridge] /exchange returned ${res.status}`);
      broadcastToRenderer("auth:error", { reason: "exchange_failed" });
      return;
    }
    const payload = /** @type {{ sessionToken: string; userId: string; expiresAt: number }} */ (
      await res.json()
    );
    if (generation !== authGeneration) {
      await revokeToken(payload.sessionToken);
      return;
    }
    if (pending.linkSteam) {
      await stageSteamLink(payload.sessionToken, generation);
      if (generation !== authGeneration) pendingSteamLink = null;
      return;
    }
    const token = payload.sessionToken;
    if (generation !== authGeneration) {
      await revokeToken(token);
      return;
    }
    persistToken(token);
    broadcastToRenderer("auth:complete", { ...payload, sessionToken: token });
  } catch (err) {
    console.error("[authBridge] exchange request failed:", err);
    captureGlitchtipException(err, {
      location: "authBridge.handleAuthDeepLink.exchange",
      provider: pending.provider,
    });
    broadcastToRenderer("auth:error", {
      reason: "network_error",
      message: err instanceof Error ? err.message : undefined,
    });
  }
}

/** @param {string} token */
async function revokeToken(token) {
  const res = await fetch(`${resolveApiUrl()}/api/auth/desktop/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionToken: token }),
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
  if (!res.ok) throw new Error("Could not revoke desktop session; retry logout when connected.");
}

/**
 * Register all auth-related `ipcMain.handle` endpoints.  Must run
 * before the first renderer loads so handlers are ready when
 * AuthContext calls `window.electron.auth.getToken()` on bootstrap.
 */
/**
 * @param {{ getTicket: () => Promise<{ ticket: string; cancel: () => void } | null>; appId: number; getUser?: () => { displayName: string } | null } | null} steam
 */
function registerAuthIpc(steam = null) {
  nativeSteam = steam;
  handleTrustedIpc(ipcMain, "auth:cancelOAuth", async () => {
    authGeneration++;
    cancelOAuth();
    const candidate = pendingSteamLink;
    pendingSteamLink = null;
    if (candidate) await revokeToken(candidate.token);
  });
  handleTrustedIpc(ipcMain, "auth:confirmSteamLink", async () => {
    const candidate = pendingSteamLink;
    if (!candidate || Date.now() - candidate.createdAt > STATE_TTL_MS)
      throw new Error("Sign-in expired. Sign in to your web account again.");
    const generation = authGeneration;
    const token = await linkActiveSteam(candidate.token);
    pendingSteamLink = null;
    if (generation !== authGeneration) {
      await revokeToken(token);
      throw new Error("Sign-in cancelled.");
    }
    persistToken(token);
    await revokeToken(candidate.token).catch(() => {});
    broadcastToRenderer("auth:complete", { sessionToken: token });
  });
  handleTrustedIpc(ipcMain, "auth:linkOAuth", async (_event, provider) => {
    if (!["google", "github", "discord", "apple", "steam"].includes(provider))
      return { ok: false, reason: "bad_provider" };
    if (!cachedToken) return { ok: false, reason: "not_authenticated" };
    evictStaleFlows();
    const state = randomUUID();
    const generation = authGeneration;
    pendingAuth.set(state, { provider, createdAt: Date.now() });
    try {
      const response = await fetch(`${resolveApiUrl()}/api/auth/desktop/link/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cachedToken}` },
        body: JSON.stringify({ provider, state }),
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error("Could not start account linking.");
      const result = /** @type {{ path?: string }} */ (await response.json());
      const target = new URL(result.path || "", resolveApiUrl());
      if (
        target.origin !== new URL(resolveApiUrl()).origin ||
        target.pathname !== "/api/auth/desktop/link/begin" ||
        !isSafeExternalUrl(target.href)
      )
        throw new Error("Invalid account-link URL.");
      if (generation !== authGeneration) throw new Error("Linking cancelled.");
      await shell.openExternal(target.href);
      return { ok: true };
    } catch {
      pendingAuth.delete(state);
      return { ok: false, reason: "link_start_failed" };
    }
  });
  handleTrustedIpc(ipcMain, "auth:startOAuth", async (_event, provider, options) => {
    if (!["google", "github", "discord", "apple", "steam"].includes(provider))
      return { ok: false, reason: "bad_provider" };
    try {
      await startOAuth(provider, options?.linkSteam === true);
      return { ok: true };
    } catch (err) {
      console.error("[authBridge] startOAuth failed:", err);
      return { ok: false, reason: "browser_launch_failed" };
    }
  });

  handleTrustedIpc(ipcMain, "auth:steam", async (_event, input) => {
    if (!steam) return { status: "unavailable" };
    const { action, username } = input ?? {};
    if (!["check", "create", "link"].includes(action)) throw new Error("Invalid Steam action.");
    const generation = authGeneration;
    const ticket = await steam.getTicket();
    if (!ticket) return { status: "unavailable" };
    const res = await fetch(`${resolveApiUrl()}/api/auth/steam/session`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        "Content-Type": "application/json",
        ...(action === "link" && cachedToken ? { Authorization: `Bearer ${cachedToken}` } : {}),
      },
      body: JSON.stringify({ action, username, ticket: ticket.ticket, appId: steam.appId }),
    }).finally(() => ticket.cancel());
    const result =
      /** @type {{ status?: string; sessionToken?: string; message?: string; profile?: { displayName: string; suggestedUsername: string; avatarUrl?: string } }} */ (
        await res.json()
      );
    if (!res.ok) throw new Error(result.message || "Steam sign-in failed.");
    if (generation !== authGeneration) {
      if (result.sessionToken) await revokeToken(result.sessionToken);
      return { status: "unavailable" };
    }
    if (result.status === "needs_setup") clearPersistedToken();
    if (result.status === "signed_in") {
      if (typeof result.sessionToken !== "string") throw new Error("Missing session token.");
      persistToken(result.sessionToken);
    }
    // Renderer reads the token through getToken after this resolves. Avoid an
    // auth-complete event racing the bootstrap that initiated this request.
    const displayName = result.profile?.displayName || steam.getUser?.()?.displayName;
    const profile =
      result.profile || (displayName ? { displayName, suggestedUsername: "" } : undefined);
    if (profile && displayName) profile.displayName = displayName;
    return { status: result.status, ...(profile ? { profile } : {}) };
  });

  handleTrustedIpc(ipcMain, "auth:login", async (_event, identifier, password, options) => {
    if (
      typeof identifier !== "string" ||
      typeof password !== "string" ||
      identifier.length > 320 ||
      password.length > 128
    )
      throw new Error("Invalid login.");
    const generation = authGeneration;
    const res = await fetch(`${resolveApiUrl()}/api/player/login`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
    });
    if (!res.ok) throw new Error("Invalid credentials.");
    const token = res.headers.get("set-auth-token");
    if (!token) throw new Error("Could not create a desktop session.");
    const exchange = await fetch(`${resolveApiUrl()}/api/auth/desktop/session`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!exchange.ok) throw new Error("Could not create a desktop session.");
    const result = /** @type {{ sessionToken?: string }} */ (await exchange.json());
    if (typeof result.sessionToken !== "string") throw new Error("Missing session token.");
    if (generation !== authGeneration) {
      await revokeToken(result.sessionToken);
      throw new Error("Sign-in cancelled.");
    }
    if (options?.linkSteam === true) {
      await stageSteamLink(result.sessionToken, generation);
      if (generation !== authGeneration) {
        pendingSteamLink = null;
        throw new Error("Sign-in cancelled.");
      }
      return { pendingSteamLink: true };
    }
    const linkedToken = result.sessionToken;
    if (generation !== authGeneration) {
      await revokeToken(linkedToken);
      throw new Error("Sign-in cancelled.");
    }
    persistToken(linkedToken);
  });

  handleTrustedIpc(ipcMain, "auth:getToken", async () => {
    return cachedToken;
  });

  handleTrustedIpc(ipcMain, "auth:logout", async () => {
    authGeneration++;
    cancelOAuth();
    const candidate = pendingSteamLink;
    pendingSteamLink = null;
    if (candidate) await revokeToken(candidate.token);
    const token = cachedToken;
    // Keep the credential on failure so the user can retry server revocation.
    if (token) await revokeToken(token);
    clearPersistedToken();
    return { ok: true };
  });

  // Renderer queries this on bootstrap so AuthContext can show a
  // one-time toast on Linux machines without libsecret, where the
  // user will be signed out on every restart.  No "warning" event
  // — the renderer pulls when it's ready.
  handleTrustedIpc(ipcMain, "auth:getPersistenceStatus", async () => {
    // Steam restores sign-in through a fresh native ticket, without disk storage.
    return { available: !PERSIST_TOKEN || isPersistenceAvailable() };
  });
}

module.exports = {
  registerAuthIpc,
  loadPersistedToken,
  handleAuthDeepLink,
  isPersistenceAvailable,
  // Exported for test / introspection by main.cjs.
  getCachedTokenForTests: () => cachedToken,
};
