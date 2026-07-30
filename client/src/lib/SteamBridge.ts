/**
 * Renderer-side wrapper around the Steamworks IPC surface exposed by
 * `desktop/preload.cjs`. The bridge only exists in the packaged
 * Electron desktop build with STEAM_BUILD=true at launch — every
 * other context (web, mobile, non-Steam desktop) sees `undefined`.
 *
 * The functions below all return safe defaults when the bridge is
 * absent or `isActive` is false, so callers can fire them
 * unconditionally without sprinkling `if (window.electron)` checks
 * across the renderer.
 *
 * For the IPC contract on the other side, see:
 *   - `desktop/src/steam.cjs`     — module implementation
 *   - `desktop/main.cjs`          — ipcMain handlers
 *   - `desktop/preload.cjs`       — contextBridge exposure
 */

export type SteamOverlayDialog =
  | "Friends"
  | "Community"
  | "Players"
  | "Settings"
  | "OfficialGameGroup"
  | "Stats"
  | "Achievements";

type SteamBridge = {
  isActive: () => Promise<boolean>;
  getUser: () => Promise<{ steamId: string; displayName: string; country?: string } | null>;
  unlockAchievement: (apiName: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
  indicateAchievementProgress: (
    apiName: string,
    current: number,
    max: number,
  ) => Promise<{ ok: true } | { ok: false; reason: string }>;
  getAchievementStates: (apiNames: string[]) => Promise<Record<string, boolean>>;
  openOverlay: (dialog: SteamOverlayDialog) => Promise<boolean>;
  openOverlayUrl: (url: string) => Promise<boolean>;
};

function getBridge(): SteamBridge | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { electron?: { steam?: SteamBridge } };
  return w.electron?.steam ?? null;
}

/**
 * True when the running binary was packaged as a Steam build.
 *
 * Deliberately synchronous and deliberately *not* the same question as
 * `isSteamActive()`:
 *
 *   - `isSteamActive()` asks "can we talk to Steam right now?" — false
 *     if the Steam client isn't running. Use it to gate Steam
 *     *features* (overlay buttons, achievement mirroring).
 *   - `isSteamBuild()` asks "was this shipped through Steam?" — true
 *     regardless of client state. Use it to gate anything Valve's
 *     distribution rules forbid, which stays forbidden whether or not
 *     Steam happens to be reachable.
 *
 * Being synchronous matters: callers like `canSeeShop()` run during
 * render and cannot await an IPC round-trip.
 */
export function isSteamBuild(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { electron?: { config?: { isSteamBuild?: boolean } } };
  return w.electron?.config?.isSteamBuild === true;
}

/**
 * Resolves true only inside the packaged Electron Steam build with a
 * live `steamworks.js` client. Use this to gate Steam-only UI (e.g.
 * the "Open in Steam" overlay buttons).
 *
 * Memoized after the first resolved call — `isActive` can't flip
 * mid-session, so we don't want every consumer re-hitting the IPC
 * round-trip on every render.
 */
let _isActiveCache: Promise<boolean> | null = null;
export function isSteamActive(): Promise<boolean> {
  if (_isActiveCache) return _isActiveCache;
  const bridge = getBridge();
  if (!bridge) {
    _isActiveCache = Promise.resolve(false);
    return _isActiveCache;
  }
  // Treat any thrown IPC error as "not active" so renderer code can
  // keep its non-Steam fallback path.
  _isActiveCache = bridge.isActive().catch(() => false);
  return _isActiveCache;
}

/** Test-only: drops the memoized isSteamActive() result. */
export function _resetSteamActiveCacheForTests(): void {
  _isActiveCache = null;
}

/**
 * Push an achievement unlock to Steam. No-op when Steam isn't active.
 * Idempotent on Steam's side, so it's safe to call repeatedly for
 * the same id.
 *
 * Returns a boolean for the caller's convenience (true = handed off to
 * Steam successfully). Failures and non-Steam contexts both yield
 * false — the server-side achievement state is authoritative either
 * way, this is just a best-effort mirror.
 */
export async function unlockSteamAchievement(apiName: string): Promise<boolean> {
  const bridge = getBridge();
  if (!bridge) return false;
  if (!(await isSteamActive())) return false;
  try {
    const res = await bridge.unlockAchievement(apiName);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Batch-fetch the current unlocked state of every supplied
 * achievement API name. Returns an empty record when Steam isn't
 * active so callers can use the result as a Map source without
 * special-casing.
 */
export async function getSteamAchievementStates(
  apiNames: string[],
): Promise<Record<string, boolean>> {
  const bridge = getBridge();
  if (!bridge) return {};
  if (!(await isSteamActive())) return {};
  try {
    return await bridge.getAchievementStates(apiNames);
  } catch {
    return {};
  }
}

/**
 * Open one of Steam's named overlay panels. Returns false when Steam
 * isn't active or the panel name is unknown — the caller can then
 * fall back to an in-app fallback dialog.
 */
export async function openSteamOverlay(dialog: SteamOverlayDialog): Promise<boolean> {
  const bridge = getBridge();
  if (!bridge) return false;
  if (!(await isSteamActive())) return false;
  try {
    return await bridge.openOverlay(dialog);
  } catch {
    return false;
  }
}

/**
 * Open the Steam overlay's in-game web browser to an http(s) URL.
 */
export async function openSteamOverlayUrl(url: string): Promise<boolean> {
  const bridge = getBridge();
  if (!bridge) return false;
  if (!(await isSteamActive())) return false;
  try {
    return await bridge.openOverlayUrl(url);
  } catch {
    return false;
  }
}
