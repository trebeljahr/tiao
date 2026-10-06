import type { NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";
import { frameHeadersFor } from "@/lib/frameHeaders";

const intlMiddleware = createMiddleware(routing);

/**
 * Locale routing (next-intl) plus the frame-embedding policy.
 *
 * Every HTML route refuses to be iframed except `/embed/*`, which is the
 * one surface built for third-party embedding (finished-game replays).
 * The header decision lives in `@/lib/frameHeaders` so it is unit-tested
 * without spinning up the middleware runtime.
 */
export default function proxy(request: NextRequest) {
  const response = intlMiddleware(request);
  for (const [key, value] of Object.entries(frameHeadersFor(request.nextUrl.pathname))) {
    response.headers.set(key, value);
  }
  return response;
}

// Exclusions (the negative-lookahead group):
//   api, ws           — backend proxied by server.mjs.
//   _next, _vercel    — Next.js / Vercel internals.
//   _e                — error-monitoring tunnel. server.mjs reverse-
//                       proxies it to GlitchTip when GLITCHTIP_PROXY_URL
//                       is set. If that var is missing (or the match
//                       races the middleware for any reason), we do NOT
//                       want next-intl rewriting the URL to /<locale>/_e
//                       and turning every reported error into a 404 page
//                       render — see issue #160.
//
//                       The GlitchTip tunnel is "/_e" (NOT "/e" or "/bugs"):
//                         - "/bugs" was the first attempt; Cloudflare's
//                           managed WAF flagged it as a suspicious
//                           recon/debug path and started 403-blocking
//                           real browser POSTs in production.
//                         - "/e" without the underscore would prefix-
//                           collide with the "en" locale here in the
//                           negative-lookahead group, silently breaking
//                           English routing.
//                         - The underscore prefix matches the existing
//                           "_next" / "_vercel" convention for infra
//                           paths that aren't user-facing.
//   .*\..*            — any path containing a dot (static assets like
//                       /sw.js, /favicon.ico, /robots.txt, images, etc.).
export const config = {
  matcher: ["/((?!api|ws|_next|_vercel|_e|.*\\..*).*)"],
};
