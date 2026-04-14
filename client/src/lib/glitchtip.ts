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
 */
import * as Sentry from "@sentry/browser";

const dsn = process.env.NEXT_PUBLIC_GLITCHTIP_DSN;
const isProd = process.env.NODE_ENV === "production";

export const glitchtipEnabled = Boolean(dsn) && isProd;

if (typeof window !== "undefined" && glitchtipEnabled) {
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
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!glitchtipEnabled) return;
  Sentry.withScope((scope) => {
    if (context) scope.setExtras(context);
    Sentry.captureException(error);
  });
}

export function setUser(user: { id: string; username?: string } | null): void {
  if (!glitchtipEnabled) return;
  Sentry.setUser(user);
}
