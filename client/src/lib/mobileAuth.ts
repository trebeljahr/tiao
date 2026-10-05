/**
 * Social sign-in for the native mobile app (Capacitor iOS / Android).
 *
 * Google rejects OAuth inside embedded WebViews (`disallowed_useragent`),
 * and Apple review expects the system sign-in sheet, so the app never
 * runs the provider flow in its own WebView. It reuses the desktop
 * bridge instead (server/routes/desktop-auth.routes.ts):
 *
 *   1. Generate `state` and a PKCE verifier; remember both on the device.
 *   2. Open /api/auth/desktop/start?provider&state&code_challenge in the
 *      system browser (SFSafariViewController / Chrome Custom Tab).
 *   3. The server finishes OAuth and redirects to
 *      tiao://auth/complete?state&code, which the OS hands back to the app
 *      (`appUrlOpen`, or the launch URL if the app was killed meanwhile).
 *   4. POST {state, code, code_verifier, token_type: "session"} to
 *      /exchange over HTTPS and keep the returned better-auth session token
 *      in Capacitor Preferences.
 *
 * That token is the app's only credential: it goes out as
 * `Authorization: Bearer` on REST and better-auth calls and as `?token=` on
 * the WebSocket. Guest, password sign-in and sign-up sessions arrive in a
 * `set-auth-token` response header instead (api.ts captureIssuedAuthToken).
 * Linking a provider uses the same browser + deep-link round trip
 * (startMobileLinkSocial, tiao://auth/linked).
 *
 * The token is never in a URL. A different app that registers `tiao://`
 * and intercepts the deep link gets state + code but not the verifier, so
 * the server refuses its exchange.
 *
 * Every export is a no-op outside a native Capacitor shell.
 */

import {
  API_BASE_URL,
  getCachedElectronToken,
  onAuthTokenIssued,
  setElectronTokenCache,
} from "./api";
import type { SocialProvider } from "./authProviders";
import { getNativeMobilePlatform } from "./distributionChannel";

const TOKEN_KEY = "tiao.mobileAuth.sessionToken";
const PENDING_KEY = "tiao.mobileAuth.pending";
/** Longer than the server's 5-minute code TTL: the user may be typing a password. */
const PENDING_TTL_MS = 15 * 60 * 1000;

export type MobileAuthPurpose = "sign-in" | "link";

export type PendingMobileAuth = {
  state: string;
  verifier: string;
  provider: SocialProvider;
  createdAt: number;
  /** Absent on flows started by older builds: those were sign-ins. */
  purpose?: MobileAuthPurpose;
};

export type MobileAuthResult =
  | {
      ok: true;
      purpose: "sign-in";
      sessionToken: string;
      userId: string;
      expiresAt: number;
    }
  | { ok: true; purpose: "link"; provider: SocialProvider }
  | { ok: false; purpose: MobileAuthPurpose; reason: string };

/** Window event fired after a provider was linked from the native app. */
export const MOBILE_LINK_COMPLETE_EVENT = "tiao:mobile-link-complete";

export function isNativeMobileApp(): boolean {
  return getNativeMobilePlatform() !== null;
}

// ---------------------------------------------------------------------------
// Capacitor plugins, loaded only inside the native shell so the web bundle
// never evaluates them.
// ---------------------------------------------------------------------------

async function preferences() {
  return (await import("@capacitor/preferences")).Preferences;
}

async function browser() {
  return (await import("@capacitor/browser")).Browser;
}

async function capApp() {
  return (await import("@capacitor/app")).App;
}

// ---------------------------------------------------------------------------
// PKCE helpers (RFC 7636)
// ---------------------------------------------------------------------------

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomUrlSafe(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

export async function codeChallengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export function buildStartUrl(
  apiBase: string,
  provider: SocialProvider,
  state: string,
  challenge: string,
): string {
  const params = new URLSearchParams({
    provider,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${apiBase}/api/auth/desktop/start?${params.toString()}`;
}

/**
 * Recognise tiao://auth/complete and tiao://auth/error. Accepts both the
 * `tiao://auth/complete` (host "auth") and `tiao:auth/complete` spellings,
 * like the desktop deep-link parser.
 */
export function parseAuthDeepLink(
  raw: string,
):
  | { kind: "complete"; state: string; code: string }
  | { kind: "error"; state: string; reason: string }
  | { kind: "linked"; state: string }
  | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "tiao:" || url.username || url.password || url.port) return null;
  const path =
    url.host === "auth"
      ? `auth${url.pathname}`
      : url.host === ""
        ? url.pathname.replace(/^\/+/, "")
        : "";
  const state = url.searchParams.get("state") ?? "";
  if (path === "auth/complete") {
    return { kind: "complete", state, code: url.searchParams.get("code") ?? "" };
  }
  if (path === "auth/error") {
    return { kind: "error", state, reason: url.searchParams.get("reason") ?? "unknown" };
  }
  if (path === "auth/linked") return { kind: "linked", state };
  return null;
}

// ---------------------------------------------------------------------------
// Token persistence
// ---------------------------------------------------------------------------

/** Load a stored token into the API module's bearer cache. Returns it. */
export async function loadPersistedMobileToken(): Promise<string | null> {
  if (!isNativeMobileApp()) return null;
  try {
    const prefs = await preferences();
    const { value } = await prefs.get({ key: TOKEN_KEY });
    // Earlier builds stored desktop v2 tokens, which better-auth does not
    // recognise (the app would look signed out and mint a guest). Drop
    // them; the user signs in again once.
    if (value && isLegacyDesktopToken(value)) {
      await prefs.remove({ key: TOKEN_KEY });
      return null;
    }
    if (value) setElectronTokenCache(value);
    return value ?? null;
  } catch {
    return null;
  }
}

function isLegacyDesktopToken(token: string): boolean {
  return token.startsWith("v2.");
}

async function persistToken(token: string): Promise<void> {
  setElectronTokenCache(token);
  await (await preferences()).set({ key: TOKEN_KEY, value: token });
}

// Every session the server issues to the app (guest, password sign-in,
// sign-up) arrives in a set-auth-token header; keep the newest one.
onAuthTokenIssued((token) => {
  if (!isNativeMobileApp()) return;
  void persistToken(token).catch(() => {
    /* the in-memory token still works until the app restarts */
  });
});

/**
 * Revoke the server-side session, then forget the token. Throws when the
 * server cannot be reached so the caller can keep the user signed in and
 * offer a retry, as the desktop app does.
 */
export async function logoutMobile(): Promise<void> {
  if (!isNativeMobileApp()) return;
  const prefs = await preferences();
  const { value: token } = await prefs.get({ key: TOKEN_KEY });
  await prefs.remove({ key: PENDING_KEY });
  if (token && isLegacyDesktopToken(token)) {
    const res = await fetch(`${API_BASE_URL}/api/auth/desktop/logout`, {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionToken: token }),
    });
    if (!res.ok) throw new Error("Could not revoke the mobile session.");
  } else if (token) {
    // better-auth session: sign out with the bearer token. A 4xx means the
    // session is already gone, which is the goal; only an unreachable or
    // failing server keeps the user signed in for a retry.
    const res = await fetch(`${API_BASE_URL}/api/auth/sign-out`, {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: "{}",
    });
    if (res.status >= 500) throw new Error("Could not revoke the mobile session.");
  }
  await prefs.remove({ key: TOKEN_KEY });
  setElectronTokenCache(null);
}

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------

async function readPending(): Promise<PendingMobileAuth | null> {
  const { value } = await (await preferences()).get({ key: PENDING_KEY });
  if (!value) return null;
  try {
    const pending = JSON.parse(value) as PendingMobileAuth;
    if (Date.now() - pending.createdAt > PENDING_TTL_MS) return null;
    return pending;
  } catch {
    return null;
  }
}

/** Open the provider's sign-in page in the system browser. */
export async function startMobileOAuth(provider: SocialProvider): Promise<void> {
  const state = randomUrlSafe(16);
  const verifier = randomUrlSafe(32);
  const challenge = await codeChallengeFor(verifier);
  const pending: PendingMobileAuth = {
    state,
    verifier,
    provider,
    createdAt: Date.now(),
    purpose: "sign-in",
  };
  // Persisted, not just in memory: Android may kill the WebView while the
  // user is in the browser, and the deep link then arrives as a launch URL.
  await (await preferences()).set({ key: PENDING_KEY, value: JSON.stringify(pending) });
  await (await browser()).open({
    url: buildStartUrl(API_BASE_URL, provider, state, challenge),
    presentationStyle: "popover",
  });
}

/**
 * Complete a flow from a deep link. Returns null when the URL is not an
 * auth callback (so other deep links pass through untouched).
 */
export async function completeMobileOAuth(
  rawUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MobileAuthResult | null> {
  const link = parseAuthDeepLink(rawUrl);
  if (!link) return null;

  const prefs = await preferences();
  const pending = await readPending();
  // One shot: whatever happens next, this state cannot be replayed.
  await prefs.remove({ key: PENDING_KEY });
  try {
    await (await browser()).close();
  } catch {
    /* Android has no programmatic close; the tab is already backgrounded */
  }

  const purpose: MobileAuthPurpose = pending?.purpose ?? "sign-in";
  if (!pending || !link.state || pending.state !== link.state) {
    return { ok: false, purpose, reason: "state_mismatch" };
  }
  if (link.kind === "error") return { ok: false, purpose, reason: link.reason };

  if (purpose === "link") {
    // Linking finished server-side; the deep link only says "refresh".
    if (link.kind !== "linked") return { ok: false, purpose, reason: "malformed_callback" };
    return { ok: true, purpose: "link", provider: pending.provider };
  }
  if (link.kind !== "complete" || !link.code) {
    return { ok: false, purpose, reason: "malformed_callback" };
  }

  let res: Response;
  try {
    res = await fetchImpl(`${API_BASE_URL}/api/auth/desktop/exchange`, {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        state: link.state,
        code: link.code,
        code_verifier: pending.verifier,
        // A better-auth session, so get-session, sign-out and linking all
        // accept the token (desktop keeps its own token type).
        token_type: "session",
      }),
    });
  } catch {
    return { ok: false, purpose, reason: "network_error" };
  }
  if (!res.ok) return { ok: false, purpose, reason: "exchange_failed" };

  const payload = (await res.json()) as {
    sessionToken?: string;
    userId?: string;
    expiresAt?: number;
  };
  if (typeof payload.sessionToken !== "string" || !payload.sessionToken) {
    return { ok: false, purpose, reason: "exchange_failed" };
  }
  await persistToken(payload.sessionToken);
  return {
    ok: true,
    purpose: "sign-in",
    sessionToken: payload.sessionToken,
    userId: payload.userId ?? "",
    expiresAt: payload.expiresAt ?? 0,
  };
}

/**
 * Link a social provider to the signed-in account from the native app.
 * The server parks the provider URL and its state cookie behind a
 * one-time ticket; the system browser redeems it and comes back with
 * tiao://auth/linked (see server/routes/mobile-auth.routes.ts).
 * Throws with the server's message when linking cannot start.
 */
export async function startMobileLinkSocial(
  provider: SocialProvider,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const token = getCachedElectronToken();
  if (!token) throw new Error("Sign in before linking an account.");
  const state = randomUrlSafe(16);
  const res = await fetchImpl(`${API_BASE_URL}/api/auth/mobile/link/start`, {
    method: "POST",
    credentials: "omit",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ provider, state }),
  });
  const body = (await res.json().catch(() => ({}))) as { path?: string; message?: string };
  if (!res.ok || typeof body.path !== "string" || !body.path.startsWith("/api/auth/mobile/")) {
    throw new Error(body.message || "Could not start linking. Please try again.");
  }
  const pending: PendingMobileAuth = {
    state,
    // No exchange follows a link, so there is no PKCE verifier to keep.
    verifier: "",
    provider,
    createdAt: Date.now(),
    purpose: "link",
  };
  await (await preferences()).set({ key: PENDING_KEY, value: JSON.stringify(pending) });
  await (await browser()).open({
    url: `${API_BASE_URL}${body.path}`,
    presentationStyle: "popover",
  });
}

/**
 * Run `onResume` whenever the app returns to the foreground, e.g. after
 * the user confirmed an email address or reset a password in the
 * browser. Returns an unsubscribe. No-op outside the native shell.
 */
export function subscribeAppResume(onResume: () => void): () => void {
  if (!isNativeMobileApp()) return () => {};
  let cancelled = false;
  let remove: (() => void) | null = null;
  void (async () => {
    const App = await capApp();
    const listener = await App.addListener("resume", () => {
      if (!cancelled) onResume();
    });
    if (cancelled) void listener.remove();
    else remove = () => void listener.remove();
  })();
  return () => {
    cancelled = true;
    remove?.();
  };
}

/**
 * Listen for auth deep links for the lifetime of the app. Also handles a
 * cold start whose launch URL is the callback. Returns an unsubscribe.
 */
export function subscribeMobileAuth(onResult: (result: MobileAuthResult) => void): () => void {
  if (!isNativeMobileApp()) return () => {};
  let cancelled = false;
  let remove: (() => void) | null = null;

  const handle = async (url: string | undefined) => {
    if (!url || cancelled) return;
    const result = await completeMobileOAuth(url);
    if (result && !cancelled) onResult(result);
  };

  void (async () => {
    const App = await capApp();
    const listener = await App.addListener("appUrlOpen", (event) => void handle(event.url));
    if (cancelled) {
      void listener.remove();
      return;
    }
    remove = () => void listener.remove();
    const launch = await App.getLaunchUrl();
    // Only act on a launch URL while a flow is pending, so an old launch
    // URL is not re-processed on every WebView reload.
    if (launch?.url && (await readPending())) await handle(launch.url);
  })();

  return () => {
    cancelled = true;
    remove?.();
  };
}
