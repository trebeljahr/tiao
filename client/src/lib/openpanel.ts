/**
 * OpenPanel analytics — shared client-side singleton.
 *
 * Three layers of gating before any event leaves the browser:
 *
 *   1. Build-time config — CLIENT_ID + API_URL env vars must be set.
 *   2. Build-time env gate — dev builds don't pull the SDK in unless
 *      NEXT_PUBLIC_OPENPANEL_ENABLE_IN_DEV=true (see cold-compile note).
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
 *   NEXT_PUBLIC_OPENPANEL_ENABLE_IN_DEV    (optional, "true" to enable in dev)
 *
 * GDPR / consent:
 *   OpenPanel has no public runtime enable/disable toggle, so we fake one
 *   by swapping the underlying instance between a real + a fully-disabled
 *   stub. Callers always import `op` — a Proxy that forwards to the
 *   current instance — so they never need to re-import after the flip.
 *   `enableTracking()` / `disableTracking()` are called by AnalyticsConsent.
 *
 * Cold-compile note (2026-04-16):
 *   `@openpanel/web` used to be `import { OpenPanel } from "@openpanel/web"`
 *   at module-top, which pulled the SDK into every route's cold compile
 *   even though dev and CI builds never run the real instance. It's now
 *   loaded via `import("@openpanel/web")` inside `getOpenPanel()`, gated
 *   by a `process.env.NODE_ENV !== "production"` early return. Next
 *   inlines `NODE_ENV` at build time, so Turbopack can prove the
 *   dynamic import is unreachable in dev and dead-code-eliminate the
 *   chunk entirely.
 *
 *   `NEXT_PUBLIC_OPENPANEL_ENABLE_IN_DEV=true` deliberately opts in to
 *   the compile cost — both halves of the condition in `getOpenPanel()`
 *   are inlined by Next, so when the flag IS set Turbopack sees a live
 *   branch and correctly includes the SDK. When it's unset (the common
 *   case), the branch collapses to `if (true) return null` and the
 *   SDK chunk is dead-code-eliminated.
 *
 *   IMPORTANT: keep `getOpenPanel()` as a plain sync function with the
 *   NODE_ENV check first and the `import()` at the bottom. Moving the
 *   import into an async body or nesting it deeper defeats Turbopack's
 *   DCE — verified empirically on Next 16.2.3. If you change this,
 *   run `node scripts/measure-cold-compile.mjs /privacy` and grep
 *   `.next/dev/static/chunks/` for "openpanel" to verify the chunk
 *   stays out of the dev bundle.
 */

/**
 * Minimal structural shape the rest of the codebase needs from an
 * OpenPanel instance. See the glitchtip.ts header for why we use a
 * local type instead of importing `OpenPanel` from `@openpanel/web`:
 * even a type-only import drags the upstream `.d.ts` into dev tooling,
 * and keeping the surface narrow means upstream signature widenings
 * don't churn this file.
 *
 * Return types are `void` on purpose: TypeScript's special handling of
 * void-returning function types lets a function that returns a value
 * (like OpenPanel.track's `Promise<...>`) be assigned to this slot,
 * because callers are expected to ignore the return value anyway.
 */
type OpenPanelLike = {
  track: (name: string, properties?: Record<string, unknown>) => void;
  identify: (props: { profileId: string } & Record<string, unknown>) => void;
  clear: () => void;
  setGlobalProperties: (props: Record<string, unknown>) => void;
  screenView?: (name: string, properties?: Record<string, unknown>) => void;
  options?: { disabled?: boolean };
};

const noop = (): void => undefined;

/** A fully-inert OpenPanel stand-in with every method as a no-op. */
function createDisabledStub(): OpenPanelLike {
  return {
    track: noop,
    identify: noop,
    clear: noop,
    setGlobalProperties: noop,
    screenView: noop,
    options: { disabled: true },
  };
}

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

// Cached lazy import. Populated on first `getOpenPanel()` call and
// reused for subsequent calls. Stays null for the entire process
// lifetime when the env gate or runtime config gate fails.
let openPanelPromise: Promise<typeof import("@openpanel/web")> | null = null;

/**
 * Lazy-load @openpanel/web. Returns null (without touching the SDK)
 * when we're in a dev/test build without ENABLE_IN_DEV, or when the
 * config env vars are missing.
 *
 * Both halves of the condition are inlined by Next at build time
 * (`process.env.NODE_ENV` + `process.env.NEXT_PUBLIC_OPENPANEL_ENABLE_IN_DEV`),
 * so when ENABLE_IN_DEV is unset the whole check collapses to
 * `if (true && true) return null` and Turbopack dead-code-eliminates
 * the dynamic import. When ENABLE_IN_DEV *is* set, the SDK loads as
 * expected — a deliberate opt-in to the compile cost.
 */
function getOpenPanel(): Promise<typeof import("@openpanel/web")> | null {
  if (process.env.NODE_ENV !== "production" && !forceEnableInDev) return null;
  if (!openPanelConfigured) return null;
  // biome-ignore lint/suspicious/noAssignInExpressions: lazy-init singleton via ??=
  return (openPanelPromise ??= import("@openpanel/web"));
}

// Start fully disabled. The real instance is only constructed once
// BOTH consent has been granted AND auth has resolved its first
// round-trip. Firing events before auth resolves would attribute them
// to an anonymous/device-level profile even when the user actually has
// a valid session token waiting to be hydrated — which pollutes the
// dashboard with phantom guest traffic.
let instance: OpenPanelLike = createDisabledStub();
let consentGranted = false;
let authReady = false;

/** Swap in the real instance when both gates are satisfied. Idempotent. */
async function maybeEnable(): Promise<void> {
  if (!openPanelConfigured) return;
  if (!consentGranted || !authReady) return;
  if (!instance.options?.disabled) return; // already real
  const mod = await getOpenPanel();
  if (!mod) return; // dev / test / misconfigured — stays on the stub
  const real = new mod.OpenPanel({
    clientId: clientId ?? "disabled",
    apiUrl: apiUrl ?? "https://placeholder.invalid",
    trackScreenViews: true,
    trackOutgoingLinks: false,
    trackAttributes: true,
    disabled: false,
  });
  instance = real;
  if (typeof window !== "undefined") {
    instance.setGlobalProperties({
      environment: "production",
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
export const op = new Proxy({} as OpenPanelLike, {
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
 * configured for OpenPanel or when running in a non-production build.
 */
export function enableTracking(): void {
  if (!openPanelConfigured) return;
  consentGranted = true;
  // Fire-and-forget: maybeEnable resolves once the lazy SDK chunk is
  // fetched and the instance swap completes. Callers don't need to
  // await — the op Proxy reads through to the current instance on
  // every access.
  void maybeEnable();
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
    void maybeEnable();
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
  instance = createDisabledStub();
}
