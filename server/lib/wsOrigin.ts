import { FRONTEND_URL } from "../config/envVars";

/** Native WebViews use stable local origins. WebSocket upgrades from those
 * origins still require a verified native bearer token; an origin grants no
 * authentication. Keep Electron origins while installed clients migrate.
 */
export const DESKTOP_ORIGIN = "app://tiao";
// Keep the Electron origin for already-installed releases during migration.
export const DESKTOP_ORIGINS: readonly string[] = [
  DESKTOP_ORIGIN,
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
];

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
 * Desktop is permitted to use its registered native origins or no origin, and
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
    if (DESKTOP_ORIGINS.includes(origin)) return true;
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
