/**
 * OpenPanel analytics — shared client-side singleton.
 *
 * Three layers of gating before any event leaves the browser:
 *
 *   1. Build-time config — CLIENT_ID + API_URL env vars must be set.
 *   2. Build-time env gate — disabled in dev unless ENABLE_IN_DEV=true.
 *   3. Runtime user consent — ConsentProvider calls `enableTracking()`
 *      only after the user opts in via the cookie banner.
 *
 * All configuration comes from environment variables; nothing is hardcoded
 * in this file, including the API URL. Missing vars boot the SDK fully
 * disabled (no-op) — safe default for forks, CI, and preview deploys.
 *
 * Env vars (see client/.env.example):
 *   NEXT_PUBLIC_OPENPANEL_CLIENT_ID        (required to enable)
 *   NEXT_PUBLIC_OPENPANEL_API_URL          (required)
 *   NEXT_PUBLIC_OPENPANEL_ENABLE_IN_DEV    (optional, "true")
 *
 * GDPR / consent:
 *   OpenPanel has no public runtime enable/disable toggle, so we fake one
 *   by swapping the underlying instance between a real + a fully-disabled
 *   stub. Callers always import `op` — a Proxy that forwards to the
 *   current instance — so they never need to re-import after the flip.
 *   `enableTracking()` / `disableTracking()` are called by AnalyticsConsent.
 */

import { OpenPanel } from "@openpanel/web";

const clientId = process.env.NEXT_PUBLIC_OPENPANEL_CLIENT_ID;
const directApiUrl = process.env.NEXT_PUBLIC_OPENPANEL_API_URL;
const isProd = process.env.NODE_ENV === "production";
const isDesktop = process.env.NEXT_PUBLIC_PLATFORM === "desktop";
// In production we normally route through `/collect` so requests look
// first-party and aren't blocked by adblockers (the proxy lives in
// `client/server.mjs`). Two exceptions bypass the proxy and go direct:
//
//   1. Dev mode — no Next.js server in front means nothing is serving
//      `/collect`, so fall back to `directApiUrl`.
//
//   2. Desktop Electron — the static export loads from `app://tiao/`
//      and there is no Node server at all. A relative `/collect` path
//      resolves to `app://tiao/collect/track`, which the protocol
//      handler 404s. Hit the OpenPanel ingest host directly instead.
//      CSP's `connect-src https:` allows the outbound request, and
//      adblockers don't block a desktop binary's network traffic.
const apiUrl = isProd && !isDesktop ? "/collect" : directApiUrl;
const forceEnableInDev = process.env.NEXT_PUBLIC_OPENPANEL_ENABLE_IN_DEV === "true";

/**
 * True when the build has a valid OpenPanel configuration AND the
 * environment gate allows sending events. Does NOT take user consent
 * into account — combine with the consent provider before tracking.
 */
export const openPanelConfigured =
  Boolean(clientId) && Boolean(directApiUrl) && (isProd || forceEnableInDev);

function createInstance(disabled: boolean): OpenPanel {
  return new OpenPanel({
    clientId: clientId ?? "disabled",
    apiUrl: apiUrl ?? "https://placeholder.invalid",
    trackScreenViews: true,
    trackOutgoingLinks: false,
    trackAttributes: true,
    disabled,
  });
}

// Start fully disabled. The real instance is only constructed once
// BOTH consent has been granted AND auth has resolved its first
// round-trip. Firing events before auth resolves would attribute them
// to an anonymous/device-level profile even when the user actually has
// a valid session token waiting to be hydrated — which pollutes the
// dashboard with phantom guest traffic.
let instance: OpenPanel = createInstance(true);
let consentGranted = false;
let authReady = false;

/** Swap in the real instance when both gates are satisfied. Idempotent. */
function maybeEnable(): void {
  if (!openPanelConfigured) return;
  if (!consentGranted || !authReady) return;
  if (!instance.options?.disabled) return; // already real
  instance = createInstance(false);
  if (typeof window !== "undefined") {
    instance.setGlobalProperties({
      environment: isProd ? "production" : "development",
      app_version: process.env.APP_VERSION ?? "unknown",
    });
  }
}

/**
 * Stable reference exposed to callers. A Proxy that forwards every
 * property access to the current `instance`, so `enableTracking()` can
 * swap the underlying object without the rest of the codebase needing
 * to re-import anything.
 */
export const op = new Proxy({} as OpenPanel, {
  get(_target, prop, _receiver) {
    // `then` is read by Promise unwrapping; return undefined so the
    // proxy isn't mistaken for a thenable.
    if (prop === "then") return undefined;
    const value = (instance as unknown as Record<string | symbol, unknown>)[prop];
    if (typeof value === "function") {
      return (value as (...args: unknown[]) => unknown).bind(instance);
    }
    return value;
  },
});

/**
 * Record that the user has granted consent. The real instance is only
 * swapped in once auth has ALSO completed its first round-trip, to
 * avoid firing anonymous events for a user who actually has a valid
 * session still being hydrated. Idempotent. No-op when the build isn't
 * configured for OpenPanel.
 */
export function enableTracking(): void {
  if (!openPanelConfigured) return;
  consentGranted = true;
  maybeEnable();
}

/**
 * Signal that AuthContext has finished bootstrapping — either the user
 * has been resolved to a logged-in PlayerIdentity or to an anonymous
 * guest. Only after this flip does the openpanel instance start sending
 * real events (assuming consent has also been granted).
 */
export function setAuthReady(ready: boolean): void {
  authReady = ready;
  if (ready) {
    maybeEnable();
  }
}

/**
 * Disable tracking and drop any in-flight profile state. Called on
 * revocation and logout. Also safe to call before any consent has been
 * granted — it just resets the instance to the disabled stub.
 */
export function disableTracking(): void {
  consentGranted = false;
  try {
    instance.clear();
  } catch {
    /* best-effort */
  }
  instance = createInstance(true);
}
