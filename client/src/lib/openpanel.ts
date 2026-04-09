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
const apiUrl = process.env.NEXT_PUBLIC_OPENPANEL_API_URL;
const isProd = process.env.NODE_ENV === "production";
const forceEnableInDev = process.env.NEXT_PUBLIC_OPENPANEL_ENABLE_IN_DEV === "true";

/**
 * True when the build has a valid OpenPanel configuration AND the
 * environment gate allows sending events. Does NOT take user consent
 * into account — combine with the consent provider before tracking.
 */
export const openPanelConfigured =
  Boolean(clientId) && Boolean(apiUrl) && (isProd || forceEnableInDev);

function createInstance(disabled: boolean): OpenPanel {
  return new OpenPanel({
    clientId: clientId ?? "disabled",
    apiUrl: apiUrl ?? "https://placeholder.invalid",
    trackScreenViews: true,
    trackOutgoingLinks: true,
    trackAttributes: true,
    disabled,
  });
}

// Start fully disabled. The consent provider flips this after reading
// persisted consent or after the user accepts the banner.
let instance: OpenPanel = createInstance(true);

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
 * Enable the real tracking instance. Idempotent. Called by the consent
 * provider when the user accepts the banner (or when persisted consent
 * from a previous session is found). No-op when the build isn't
 * configured for OpenPanel.
 */
export function enableTracking(): void {
  if (!openPanelConfigured) return;
  instance = createInstance(false);
  if (typeof window !== "undefined") {
    instance.setGlobalProperties({
      environment: isProd ? "production" : "development",
      app_version: process.env.APP_VERSION ?? "unknown",
    });
  }
}

/**
 * Disable tracking and drop any in-flight profile state. Called on
 * revocation and logout. Also safe to call before any consent has been
 * granted — it just resets the instance to the disabled stub.
 */
export function disableTracking(): void {
  try {
    instance.clear();
  } catch {
    /* best-effort */
  }
  instance = createInstance(true);
}
