/**
 * Runtime resolver for dynamic route parameters in the static exports.
 *
 * The desktop (Electron) and mobile (Capacitor) apps ship a static
 * export of the Next.js client. Static export can only pre-render
 * dynamic routes whose params are known at build time, so the
 * shareable routes — /game/[gameId], /profile/[username],
 * /tournament/[tournamentId], /embed/game/[gameId] — bake ONE page
 * with the placeholder param `__spa__`. The native shell serves that
 * page for any real value:
 *
 *   app://tiao/en/game/ABC123/        →  en/game/__spa__/index.html  (desktop/src/protocol.cjs)
 *   https://localhost/en/game/ABC123/ →  en/game/__spa__/index.html  (mobile TiaoRoutes, iOS + Android)
 *
 * Inside that page, useParams() returns the bake-time placeholder
 * (`{ gameId: "__spa__" }`), not the real value. `resolveDynamicParam` (and the `useDynamicParam` hook in
 * `./useDynamicParam`) recover
 * the real segment from the URL. On the web the bake-time value is the
 * real one and passes through unchanged.
 */

const SPA_PLACEHOLDER = "__spa__";

/**
 * Resolve a dynamic route segment.
 *
 * @param prefixSegment  The path segment immediately before the dynamic
 *                       value. For `/en/game/ABC123` → `"game"`.
 * @param bakeTimeValue  The value `useParams()` returned.
 * @param pathname       The current path. Pass the router's pathname
 *                       (`usePathname()`) during render: during a
 *                       client-side navigation `window.location` still
 *                       shows the previous page. Defaults to
 *                       `window.location.pathname`.
 * @returns              The real value, or `undefined` if it cannot be
 *                       recovered.
 */
export function resolveDynamicParam(
  prefixSegment: string,
  bakeTimeValue: string | undefined,
  pathname?: string | null,
): string | undefined {
  // Web, or any route that was not placeholder-baked: trust the value.
  if (bakeTimeValue !== SPA_PLACEHOLDER) return bakeTimeValue;

  const path = pathname ?? (typeof window === "undefined" ? undefined : window.location.pathname);
  if (!path) return undefined;

  const segments = path.split("/").filter(Boolean);
  const prefixIdx = segments.lastIndexOf(prefixSegment);
  if (prefixIdx < 0 || prefixIdx >= segments.length - 1) return undefined;
  let candidate: string;
  try {
    candidate = decodeURIComponent(segments[prefixIdx + 1]);
  } catch {
    return undefined;
  }
  // The placeholder page itself (`/game/__spa__/`) names no real value.
  if (candidate === SPA_PLACEHOLDER) return undefined;
  return candidate;
}

/** Exported for the route page files' generateStaticParams. */
export const DESKTOP_SPA_PARAM_VALUE = SPA_PLACEHOLDER;
