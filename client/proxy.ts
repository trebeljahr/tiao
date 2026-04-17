import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";

export default createMiddleware(routing);

// Exclusions (the negative-lookahead group):
//   api, ws           — backend proxied by server.mjs.
//   _next, _vercel    — Next.js / Vercel internals.
//   collect, bugs     — analytics/error infra paths. server.mjs reverse-
//                       proxies these to OpenPanel / GlitchTip when the
//                       OPENPANEL_PROXY_URL / GLITCHTIP_PROXY_URL env
//                       vars are set. If those vars are missing (or the
//                       match races the middleware for any reason), we
//                       do NOT want next-intl rewriting the URL to
//                       /<locale>/collect/track or /<locale>/bugs and
//                       turning every tracked event into a 404 page
//                       render — see issue #160.
//   .*\..*            — any path containing a dot (static assets like
//                       /sw.js, /favicon.ico, /robots.txt, images, etc.).
export const config = {
  matcher: ["/((?!api|ws|_next|_vercel|collect|bugs|.*\\..*).*)"],
};
