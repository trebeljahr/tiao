import { locales } from "@/i18n/routing";
import { EMBED_PATH_SEGMENT } from "@/lib/embed";

/**
 * Frame-embedding policy, applied per request in `client/proxy.ts`.
 *
 * Everything the app serves refuses to render inside an iframe
 * (clickjacking hardening), EXCEPT the `/embed/` routes, which exist
 * precisely so other sites can iframe a finished game. Those get an
 * explicit `frame-ancestors *` so the policy is visible in the response
 * rather than merely absent.
 *
 * `X-Frame-Options` has no "allow everyone" value, so the embed branch
 * only sets the CSP directive; browsers that understand CSP ignore
 * X-Frame-Options when `frame-ancestors` is present anyway.
 */
export const FRAME_DENY_HEADERS: Readonly<Record<string, string>> = {
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'",
};

export const FRAME_ALLOW_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": "frame-ancestors *",
};

const EMBED_PATH_PATTERN = new RegExp(
  `^/(?:(?:${locales.join("|")})/)?${EMBED_PATH_SEGMENT}(?:/|$)`,
);

/** True for `/embed/...` and its locale-prefixed variants (`/de/embed/...`). */
export function isEmbedPath(pathname: string): boolean {
  return EMBED_PATH_PATTERN.test(pathname);
}

export function frameHeadersFor(pathname: string): Readonly<Record<string, string>> {
  return isEmbedPath(pathname) ? FRAME_ALLOW_HEADERS : FRAME_DENY_HEADERS;
}
