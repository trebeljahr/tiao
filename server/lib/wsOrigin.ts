import { FRONTEND_URL } from "../config/envVars";

/**
 * Origin whitelist for the desktop Electron build.  The Electron
 * BrowserWindow loads the static client bundle from the `app://tiao/`
 * custom protocol, and some platforms (Linux in particular) send
 * WebSocket upgrades without an Origin header at all.  Both are
 * acceptable ONLY when the upgrade request carries a valid bearer
 * token in the `?token=` query param — the token is the actual
 * authentication.
 */
export const DESKTOP_ORIGIN = "app://tiao";

/**
 * Origins of the Capacitor WebView: iOS serves the bundle from
 * `capacitor://localhost`, Android from `https://localhost`. Like the
 * desktop origin they are accepted only alongside a valid bearer token.
 */
export const MOBILE_ORIGINS: readonly string[] = ["capacitor://localhost", "https://localhost"];

/**
 * Decide whether a WebSocket upgrade from `origin` is allowed.
 *
 * Web clients must originate from `FRONTEND_URL` (or a localhost
 * variant in dev).  This check is a defense-in-depth measure against
 * Cross-Site WebSocket Hijacking — browsers can't lie about Origin,
 * so an attacker's page can't trick a logged-in user into opening
 * a hijacked socket.
 *
 * Desktop Electron clients bypass the origin match when they present
 * a valid bearer token in the URL.  The token itself is the primary
 * authentication; origin is still enforced to prevent `origin: https://attacker.com`
 * from being accepted just because a stolen token leaks in the query.
 * Desktop is permitted to use `app://tiao` or no origin at all, and
 * nothing else.
 */
export function isAllowedOrigin(
  origin: string | undefined,
  options: { hasValidDesktopToken?: boolean } = {},
): boolean {
  // Desktop exception: bearer token authenticated the connection, so
  // we trust an app:// or missing origin.  We still reject any other
  // explicit origin (attacker.com with a stolen token).
  if (options.hasValidDesktopToken) {
    if (!origin) return true;
    if (origin === DESKTOP_ORIGIN) return true;
    if (MOBILE_ORIGINS.includes(origin)) return true;
  }

  if (!origin) return false;
  if (!FRONTEND_URL) return true; // dev mode — allow all
  try {
    const allowed = new URL(FRONTEND_URL).origin;
    const incoming = new URL(origin).origin;
    if (incoming === allowed) return true;
    // Allow any localhost origin in development (e2e tests use a different port)
    if (incoming.match(/^https?:\/\/localhost(:\d+)?$/) && allowed.includes("localhost"))
      return true;
    return false;
  } catch {
    return false;
  }
}
