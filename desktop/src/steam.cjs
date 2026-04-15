// @ts-check
/**
 * Steamworks SDK integration for the Steam build variant of the
 * Tiao desktop app (Phase 3b scaffolding).
 *
 * ## Gating
 *
 * This module is a no-op unless `STEAM_BUILD=true` is set at launch
 * time.  The gate is runtime so a single packaged binary can in
 * principle serve both the standalone (itch.io / direct download)
 * and the Steam distribution — electron-builder's extraMetadata +
 * per-target env var injection flips the flag.  In Phase 3b we ship
 * two separate builds anyway (see package:steam), but the runtime
 * check keeps the door open for a unified binary if the bundle
 * size delta ever becomes acceptable.
 *
 * When the gate is off:
 *   - `initSteam()` returns immediately
 *   - `steamworks.js` is never `require()`d (native binding load
 *     cost avoided entirely)
 *   - every other export is a no-op stub
 *
 * ## Lifecycle
 *
 * Steamworks requires `steam_appid.txt` in the process's current
 * working directory AND a running Steam client.  On init failure
 * (Steam not running, wrong appid, missing binding) we log a
 * warning and disable the module — the rest of the app keeps
 * working as a regular standalone build.  No crash, no blocked
 * boot.
 *
 * Callbacks from Steam (achievement unlocks, friend updates, Rich
 * Presence queries) arrive via `runCallbacks()` which we pump on a
 * 100 ms interval.  That's not aggressive enough to spin a CPU
 * but fast enough that achievement popups feel responsive.
 *
 * ## Current state
 *
 * This is SCAFFOLDING.  The appid points at Valve's public Spacewar
 * test app (480) which anyone with a Steam account can init
 * against — useful for local verification that the SDK loads.
 * A real Tiao appid needs to be provisioned via the Steam Partner
 * Portal before a real Steam release.  When that happens, set
 * `TIAO_STEAM_APPID` in the env (release.sh / CI secrets) and the
 * module picks it up automatically.
 *
 * ## Exposed surface (for IPC)
 *
 *   initSteam()                → called once from main.cjs bootstrap
 *   shutdownSteam()            → called from before-quit
 *   isSteamActive()            → `true` once Steam init succeeded
 *   getSteamUser()             → { steamId, displayName, country } | null
 *   unlockAchievement(apiName) → Steam API name (not localised label)
 *   indicateAchievementProgress(apiName, current, max)
 *
 * The renderer reaches these via the `steam` surface on the
 * preload contextBridge (see desktop/preload.cjs, added alongside
 * this file).  Renderer code in the Next.js client checks
 * `window.electron.steam?.isActive` before calling any of these.
 */

/** Env-var gate: STEAM_BUILD=true flips Steam integration on. */
const STEAM_ENABLED = process.env.STEAM_BUILD === "true";

/**
 * App ID used when TIAO_STEAM_APPID is unset.  480 is Valve's
 * public Spacewar test app — achievements, stats, and callbacks
 * all work against it for anyone with a Steam account, which makes
 * it useful as a scaffolding placeholder.
 */
const SPACEWAR_APPID = 480;
const STEAM_APPID = Number.parseInt(process.env.TIAO_STEAM_APPID ?? "", 10) || SPACEWAR_APPID;

const CALLBACK_INTERVAL_MS = 100;

/**
 * `steamworks.js` client instance once initialized.  Kept module-local
 * so the rest of the file can check liveness with a simple truthy
 * check on `client`.
 *
 * @type {any}
 */
let client = null;

/** @type {NodeJS.Timeout | null} */
let callbackTimer = null;

/**
 * Initialize the Steamworks SDK.  Safe to call unconditionally —
 * silently returns when STEAM_BUILD is not set.
 *
 * @returns {boolean} true if Steam initialized successfully
 */
function initSteam() {
  if (!STEAM_ENABLED) return false;
  if (client) return true; // idempotent

  let steamworks;
  try {
    // Lazy require so the native binding load cost only hits the
    // Steam build.  Also lets the standalone build ship without
    // steamworks.js in node_modules if we ever split the deps.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    steamworks = require("steamworks.js");
  } catch (err) {
    console.warn("[steam] steamworks.js not available:", err);
    return false;
  }

  try {
    client = steamworks.init(STEAM_APPID);
    console.info(`[steam] initialized against appid ${STEAM_APPID}`);
  } catch (err) {
    console.warn(
      `[steam] init(${STEAM_APPID}) failed — is the Steam client running?`,
      err,
    );
    client = null;
    return false;
  }

  // Pump the Steam callback queue.  Without this, achievement
  // unlocks silently fail to fire on the Steam servers and the
  // overlay never gets UI updates.
  callbackTimer = setInterval(() => {
    try {
      if (client && typeof client.callbacks?.runCallbacks === "function") {
        client.callbacks.runCallbacks();
      }
    } catch (err) {
      console.error("[steam] runCallbacks threw:", err);
    }
  }, CALLBACK_INTERVAL_MS);
  callbackTimer.unref?.();

  return true;
}

/**
 * Tear down Steam callbacks before the process exits.  Called from
 * main.cjs's before-quit handler.
 */
function shutdownSteam() {
  if (callbackTimer) {
    clearInterval(callbackTimer);
    callbackTimer = null;
  }
  client = null;
}

/** Returns true once `initSteam()` has succeeded. */
function isSteamActive() {
  return client !== null;
}

/**
 * Read the current Steam user's profile.  Returns null when Steam
 * isn't active or any field fails to load — individual getters on
 * steamworks.js can throw if called before callbacks have primed
 * the local user cache, so wrap each access defensively.
 *
 * @returns {{ steamId: string; displayName: string; country?: string } | null}
 */
function getSteamUser() {
  if (!client) return null;
  try {
    const steamId = client.localplayer?.getSteamId?.()?.toString();
    const displayName = client.localplayer?.getName?.();
    if (!steamId || !displayName) return null;
    let country;
    try {
      country = client.localplayer?.getIpCountry?.();
    } catch {
      /* optional — country lookup is allowed to fail */
    }
    return { steamId, displayName, country };
  } catch (err) {
    console.error("[steam] getSteamUser failed:", err);
    return null;
  }
}

/**
 * Unlock an achievement by its Steam API name (the internal ID, not
 * the localised display name).  API names are configured in the
 * Steamworks Partner Portal and listed in `shared/src/achievements.ts`
 * once the Tiao appid is live — until then this is a no-op stub
 * against Spacewar's achievements.
 *
 * @param {string} apiName
 */
function unlockAchievement(apiName) {
  if (!client) return;
  try {
    const ach = client.achievement;
    if (typeof ach?.activate === "function") {
      ach.activate(apiName);
    }
  } catch (err) {
    console.error(`[steam] unlockAchievement(${apiName}) failed:`, err);
  }
}

/**
 * Show an achievement-progress indicator popup without actually
 * unlocking.  Useful for "5 / 10 captures" style goals.  No-op when
 * Steam isn't active.
 *
 * @param {string} apiName
 * @param {number} current
 * @param {number} max
 */
function indicateAchievementProgress(apiName, current, max) {
  if (!client) return;
  try {
    const ach = client.achievement;
    if (typeof ach?.indicateAchievementProgress === "function") {
      ach.indicateAchievementProgress(apiName, current, max);
    }
  } catch (err) {
    console.error(`[steam] indicateAchievementProgress(${apiName}) failed:`, err);
  }
}

module.exports = {
  STEAM_ENABLED,
  initSteam,
  shutdownSteam,
  isSteamActive,
  getSteamUser,
  unlockAchievement,
  indicateAchievementProgress,
};
