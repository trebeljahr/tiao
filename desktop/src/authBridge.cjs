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
const { randomUUID } = require("node:crypto");
const { track } = require("./analytics.cjs");

const TOKEN_FILE = "tiao-desktop-auth.enc";
const STATE_TTL_MS = 5 * 60 * 1000;

/**
 * The base URL of the Tiao API — injected at build time via the
 * TIAO_API_URL env var so the maintainer's release script can point
 * it at a staging backend without editing source.  Defaults to the
 * production URL.
 */
const API_BASE_URL = process.env.TIAO_API_URL || "https://api.playtiao.com";

/**
 * In-memory table of pending OAuth flows.  Each entry is keyed by
 * the server-facing `state` UUID we generated in `startOAuth`.
 * Expires after STATE_TTL_MS.
 *
 * @type {Map<string, { provider: string; createdAt: number }>}
 */
const pendingAuth = new Map();

/** In-memory cache of the current session token (or null). */
let cachedToken = /** @type {string | null} */ (null);

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
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn(
      "[authBridge] safeStorage unavailable — token will not survive app restart.",
    );
    return;
  }
  try {
    const encrypted = safeStorage.encryptString(token);
    fs.writeFileSync(getTokenFilePath(), encrypted, { mode: 0o600 });
  } catch (err) {
    console.error("[authBridge] failed to persist encrypted token:", err);
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
async function startOAuth(provider) {
  evictStaleFlows();
  const state = randomUUID();
  pendingAuth.set(state, { provider, createdAt: Date.now() });
  track("desktop:auth_flow_start", { provider });
  const url = `${API_BASE_URL}/api/auth/desktop/start?provider=${encodeURIComponent(
    provider,
  )}&state=${encodeURIComponent(state)}`;
  await shell.openExternal(url);
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
  const kind = parsedUrl.pathname.replace(/^\/+/, ""); // "auth/complete" or "auth/error"
  const state = parsedUrl.searchParams.get("state") || "";
  const code = parsedUrl.searchParams.get("code") || "";
  const reason = parsedUrl.searchParams.get("reason") || "unknown";

  evictStaleFlows();
  const pending = pendingAuth.get(state);
  if (!pending) {
    console.warn(`[authBridge] deep link received for unknown or expired state: ${state}`);
    track("desktop:auth_flow_failed", { reason: "state_mismatch" });
    broadcastToRenderer("auth:error", { reason: "state_mismatch" });
    return;
  }
  pendingAuth.delete(state);

  if (kind === "auth/error") {
    track("desktop:auth_flow_failed", { reason, provider: pending.provider });
    broadcastToRenderer("auth:error", { reason });
    return;
  }

  if (kind !== "auth/complete" || !code) {
    track("desktop:auth_flow_failed", { reason: "malformed_callback", provider: pending.provider });
    broadcastToRenderer("auth:error", { reason: "malformed_callback" });
    return;
  }

  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/desktop/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state, code }),
    });
    if (!res.ok) {
      console.warn(`[authBridge] /exchange returned ${res.status}`);
      track("desktop:auth_flow_failed", {
        reason: "exchange_failed",
        status: res.status,
        provider: pending.provider,
      });
      broadcastToRenderer("auth:error", { reason: "exchange_failed" });
      return;
    }
    const payload = /** @type {{ sessionToken: string; userId: string; expiresAt: number }} */ (
      await res.json()
    );
    persistToken(payload.sessionToken);
    track("desktop:auth_flow_complete", { provider: pending.provider });
    broadcastToRenderer("auth:complete", payload);
  } catch (err) {
    console.error("[authBridge] exchange request failed:", err);
    track("desktop:auth_flow_failed", { reason: "network_error", provider: pending.provider });
    broadcastToRenderer("auth:error", { reason: "network_error" });
  }
}

/**
 * Register all auth-related `ipcMain.handle` endpoints.  Must run
 * before the first renderer loads so handlers are ready when
 * AuthContext calls `window.electron.auth.getToken()` on bootstrap.
 */
function registerAuthIpc() {
  ipcMain.handle("auth:startOAuth", async (_event, provider) => {
    if (typeof provider !== "string") return { ok: false, reason: "bad_provider" };
    try {
      await startOAuth(provider);
      return { ok: true };
    } catch (err) {
      console.error("[authBridge] startOAuth failed:", err);
      return { ok: false, reason: "browser_launch_failed" };
    }
  });

  ipcMain.handle("auth:getToken", async () => {
    return cachedToken;
  });

  ipcMain.handle("auth:logout", async () => {
    clearPersistedToken();
    return { ok: true };
  });

  // Renderer queries this on bootstrap so AuthContext can show a
  // one-time toast on Linux machines without libsecret, where the
  // user will be signed out on every restart.  No "warning" event
  // — the renderer pulls when it's ready.
  ipcMain.handle("auth:getPersistenceStatus", async () => {
    return { available: isPersistenceAvailable() };
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
