import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";

export default createMiddleware(routing);

// Exclusions (the negative-lookahead group):
//   api, ws           — backend proxied by server.mjs.
//   _next, _vercel    — Next.js / Vercel internals.
//   collect, _e       — analytics/error infra paths. server.mjs reverse-
//                       proxies these to OpenPanel / GlitchTip when the
//                       OPENPANEL_PROXY_URL / GLITCHTIP_PROXY_URL env
//                       vars are set. If those vars are missing (or the
//                       match races the middleware for any reason), we
//                       do NOT want next-intl rewriting the URL to
//                       /<locale>/collect/track or /<locale>/_e and
//                       turning every tracked event into a 404 page
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
  matcher: ["/((?!api|ws|_next|_vercel|collect|_e|.*\\..*).*)"],
};
