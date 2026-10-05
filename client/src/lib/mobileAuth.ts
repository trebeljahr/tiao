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
 *   4. POST {state, code, code_verifier} to /exchange over HTTPS and keep
 *      the returned revocable bearer token in Capacitor Preferences.
 *
 * The token is never in a URL. A different app that registers `tiao://`
 * and intercepts the deep link gets state + code but not the verifier, so
 * the server refuses its exchange.
 *
 * Every export is a no-op outside a native Capacitor shell.
 */

import { API_BASE_URL, setElectronTokenCache } from "./api";
import type { SocialProvider } from "./authProviders";
import { getNativeMobilePlatform } from "./distributionChannel";

const TOKEN_KEY = "tiao.mobileAuth.sessionToken";
const PENDING_KEY = "tiao.mobileAuth.pending";
/** Longer than the server's 5-minute code TTL: the user may be typing a password. */
const PENDING_TTL_MS = 15 * 60 * 1000;

export type PendingMobileAuth = {
  state: string;
  verifier: string;
  provider: SocialProvider;
  createdAt: number;
};

export type MobileAuthResult =
  | { ok: true; sessionToken: string; userId: string; expiresAt: number }
  | { ok: false; reason: string };

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
  return null;
}

// ---------------------------------------------------------------------------
// Token persistence
// ---------------------------------------------------------------------------

/** Load a stored token into the API module's bearer cache. Returns it. */
export async function loadPersistedMobileToken(): Promise<string | null> {
  if (!isNativeMobileApp()) return null;
  try {
    const { value } = await (await preferences()).get({ key: TOKEN_KEY });
    if (value) setElectronTokenCache(value);
    return value ?? null;
  } catch {
    return null;
  }
}

async function persistToken(token: string): Promise<void> {
  setElectronTokenCache(token);
  await (await preferences()).set({ key: TOKEN_KEY, value: token });
}

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
  if (token) {
    const res = await fetch(`${API_BASE_URL}/api/auth/desktop/logout`, {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionToken: token }),
    });
    if (!res.ok) throw new Error("Could not revoke the mobile session.");
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
  const pending: PendingMobileAuth = { state, verifier, provider, createdAt: Date.now() };
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

  if (!pending || !link.state || pending.state !== link.state) {
    return { ok: false, reason: "state_mismatch" };
  }
  if (link.kind === "error") return { ok: false, reason: link.reason };
  if (!link.code) return { ok: false, reason: "malformed_callback" };

  let res: Response;
  try {
    res = await fetchImpl(`${API_BASE_URL}/api/auth/desktop/exchange`, {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: link.state, code: link.code, code_verifier: pending.verifier }),
    });
  } catch {
    return { ok: false, reason: "network_error" };
  }
  if (!res.ok) return { ok: false, reason: "exchange_failed" };

  const payload = (await res.json()) as {
    sessionToken?: string;
    userId?: string;
    expiresAt?: number;
  };
  if (typeof payload.sessionToken !== "string" || !payload.sessionToken) {
    return { ok: false, reason: "exchange_failed" };
  }
  await persistToken(payload.sessionToken);
  return {
    ok: true,
    sessionToken: payload.sessionToken,
    userId: payload.userId ?? "",
    expiresAt: payload.expiresAt ?? 0,
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
