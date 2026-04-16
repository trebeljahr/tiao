/**
 * GlitchTip (Sentry-compatible) error monitoring — client-side singleton.
 *
 * Env vars:
 *   NEXT_PUBLIC_GLITCHTIP_DSN   (required to enable; build-time only)
 *
 * When DSN is unset all exports are no-ops. Safe for dev and CI.
 *
 * Gated to production-only because:
 *   1. In dev we use `next dev` directly, which bypasses `server.mjs` and
 *      its `/bugs` envelope proxy — so tunnelled POSTs get rewritten by
 *      next-intl middleware to `/<locale>/bugs` and 404.
 *   2. Local errors show up in the dev console already; there's no value
 *      in shipping them to GlitchTip and polluting the production project.
 *   3. In the desktop Electron build the `/bugs` tunnel resolves to
 *      `app://tiao/bugs` which the protocol handler doesn't map to a
 *      file — every session-capture POST would 404. Main-process crash
 *      reporting is planned as a follow-up; the renderer stays silent
 *      for now to avoid spamming the dev tools console.
 *
 * Cold-compile note (2026-04-16):
 *   `@sentry/browser` is a very large SDK (thousands of files). We used
 *   to `import * as Sentry from "@sentry/browser"` at module-top, which
 *   forced Turbopack to compile the entire SDK module graph into every
 *   route's cold compile — even in dev where glitchtip is always disabled.
 *   It's now `import("@sentry/browser")` inside an `if (process.env.NODE_ENV
 *   !== "production") return` branch so Turbopack dead-code-eliminates
 *   the expression in dev builds and the SDK never enters the critical
 *   path. Keep the production check BEFORE the glitchtipEnabled check so
 *   the eliminator can prove the branch is dead at compile time.
 */

const dsn = process.env.NEXT_PUBLIC_GLITCHTIP_DSN;
const isProd = process.env.NODE_ENV === "production";
const isDesktop = process.env.NEXT_PUBLIC_PLATFORM === "desktop";

export const glitchtipEnabled = Boolean(dsn) && isProd && !isDesktop;

// Cached lazy import. Populated on first `getSentry()` call and reused
// for subsequent calls. Stays null for the entire process lifetime when
// glitchtip is disabled so the SDK never loads.
let sentryPromise: Promise<typeof import("@sentry/browser")> | null = null;

/**
 * Lazy-load @sentry/browser. Returns null (without touching the SDK)
 * when glitchtip is disabled, which is always the case in dev, in the
 * desktop build, and when the DSN env var is unset.
 *
 * The `process.env.NODE_ENV !== "production"` check is first on purpose:
 * Next.js inlines that env var at build time, so Turbopack/webpack can
 * statically prove the branch is taken in dev and dead-code-eliminate
 * everything below — including the `import("@sentry/browser")`
 * expression. In a production build the env check is a no-op and the
 * glitchtipEnabled runtime gate still applies.
 */
function getSentry(): Promise<typeof import("@sentry/browser")> | null {
  if (process.env.NODE_ENV !== "production") return null;
  if (!glitchtipEnabled) return null;
  return (sentryPromise ??= import("@sentry/browser"));
}

// Kick off async init at module load when enabled. Fire-and-forget —
// `.then` callbacks on the same cached promise run in the order they
// were attached, so any subsequent captureException / setUser calls
// see Sentry.init() as having run first.
if (typeof window !== "undefined" && glitchtipEnabled) {
  const promise = getSentry();
  if (promise) {
    void promise.then((Sentry) => {
      Sentry.init({
        dsn: dsn!,
        // Route envelopes through /bugs so requests look first-party and aren't
        // blocked by adblockers or privacy extensions that filter sentry/glitchtip
        // domains. The server.mjs proxy extracts the project ID from the envelope
        // header and forwards to the real GlitchTip ingestion endpoint.
        tunnel: "/bugs",
        environment: process.env.NODE_ENV ?? "development",
        release: process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown",
      });
    });
  }
}

/**
 * Report an exception to GlitchTip. Fire-and-forget: the call returns
 * synchronously but the actual capture happens once the lazy Sentry
 * chunk has finished loading (first call pays the chunk load, later
 * calls resolve immediately from cache). In dev / disabled builds this
 * is a no-op.
 */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  const promise = getSentry();
  if (!promise) return;
  void promise.then((Sentry) => {
    Sentry.withScope((scope) => {
      if (context) scope.setExtras(context);
      Sentry.captureException(error);
    });
  });
}

/**
 * Associate subsequent events with a user identity (or clear it when
 * `user` is null). Fire-and-forget; no-op when disabled.
 */
export function setUser(user: { id: string; username?: string } | null): void {
  const promise = getSentry();
  if (!promise) return;
  void promise.then((Sentry) => Sentry.setUser(user));
}
