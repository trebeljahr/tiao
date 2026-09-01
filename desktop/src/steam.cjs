// @ts-check
/**
 * Steamworks SDK integration for the Steam build variant of the
 * Tiao desktop app (Phase 3b scaffolding).
 *
 * ## Gating
 *
 * Steam integration is off unless the build is flagged as a Steam
 * build.  Two independent sources flip it on, checked in order:
 *
 *   1. `STEAM_BUILD=true` in the environment — the dev/CI path.
 *      `npm run dev` with the var set exercises the Steam code path
 *      against a locally running Steam client.
 *   2. `steamBuild: true` in the app's own package.json — the
 *      *packaged* path.  `npm run package:steam` injects this via
 *      electron-builder's `--config.extraMetadata`, so the flag
 *      travels inside the artifact.
 *
 * (2) exists because env vars do NOT survive packaging.  Steam
 * launches the installed binary with whatever environment the Steam
 * client has, which will never contain `STEAM_BUILD` — so an
 * env-only gate silently disables Steam in exactly the build that
 * needs it.  The baked metadata is the load-bearing mechanism; the
 * env var is a dev-time override on top.
 *
 * When the gate is off:
 *   - `initSteam()` returns immediately
 *   - `steamworks.js` is never `require()`d (native binding load
 *     cost avoided entirely)
 *   - every other export is a no-op stub
 *
 * ## Lifecycle — three phases, and the order matters
 *
 * Steam integration is NOT a single init call.  Two things must
 * happen before Electron's `app` is ready, and only the third can
 * wait for `whenReady()`:
 *
 *   1. `maybeRestartForSteam()` — pre-ready.  Steam's DRM wrapper
 *      wants the game relaunched through the Steam client when it
 *      was started directly from the filesystem.  Must run before
 *      any window exists, otherwise the user sees a window flash
 *      and die.
 *   2. `prepareSteamOverlay()` — pre-ready, and this one is easy to
 *      get wrong.  `electronEnableSteamOverlay()` appends the
 *      `in-process-gpu` and `disable-direct-composition` Chromium
 *      switches.  Chromium reads its command line once, during app
 *      startup — switches appended after `whenReady()` are simply
 *      ignored, and the overlay then attaches but never renders.
 *      The failure mode looks exactly like "Valve's Electron
 *      overlay support is broken on this platform", which is why
 *      it is worth being explicit: it is an ordering bug, not a
 *      platform bug.
 *   3. `initSteam()` — post-ready.  Opens the actual SDK
 *      connection.  Needs a running Steam client.
 *
 * On failure at any phase (Steam not running, wrong appid, missing
 * native binding) we log a warning and degrade to standalone
 * behavior.  No crash, no blocked boot.
 *
 * Callbacks are pumped by `steamworks.js` itself — `init()` starts
 * its own 30 Hz `runCallbacks` interval internally, and strips
 * `runCallbacks` off the client object it returns.  This module
 * must NOT add a second pump.
 *
 * ## Current state
 *
 * The default appid is Valve's public Spacewar test app (480),
 * which anyone with a Steam account can init against — useful for
 * verifying the SDK loads at all.  A real Tiao appid must be
 * provisioned via the Steam Partner Portal before release and
 * passed as `TIAO_STEAM_APPID` at package time.
 *
 * ## Exposed surface
 *
 *   maybeRestartForSteam()     → pre-ready; true = we're quitting
 *   prepareSteamOverlay()      → pre-ready; installs GPU switches
 *   initSteam()                → called once from main.cjs bootstrap
 *   shutdownSteam()            → called from before-quit
 *   isSteamActive()            → `true` once Steam init succeeded
 *   getSteamUser()             → { steamId, displayName, country } | null
 *   unlockAchievement(apiName) → Steam API name (not localised label)
 *   indicateAchievementProgress(apiName, current, max)
 *   getAchievementStates(names) → { [apiName]: boolean } batch fetch
 *   setStats(stats)            → write + persist integer stats
 *   openOverlay(dialog)        → activate Friends / Achievements / etc.
 *   openOverlayUrl(url)        → activate overlay to a web URL
 *
 * The renderer reaches these via the `steam` surface on the
 * preload contextBridge (see desktop/preload.cjs, added alongside
 * this file).  Renderer code in the Next.js client checks
 * `window.electron.steam?.isActive` before calling any of these.
 */

/**
 * Build metadata baked into the packaged app's package.json by
 * `package:steam` (electron-builder `--config.extraMetadata.*`).
 * Absent in dev and in standalone builds, hence the try/catch.
 *
 * @type {{ steamBuild?: boolean | string; steamAppId?: number | string }}
 */
let bakedMeta = {};
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  bakedMeta = require("../package.json");
} catch {
  /* no package.json reachable — treat as standalone */
}

/**
 * Gate: env var (dev override) OR baked metadata (packaged Steam
 * build).  electron-builder's CLI parser can hand back either a
 * real boolean or the string "true" depending on how the value is
 * quoted, so accept both.
 */
const STEAM_ENABLED =
  process.env.STEAM_BUILD === "true" ||
  bakedMeta.steamBuild === true ||
  bakedMeta.steamBuild === "true";

/**
 * App ID used when nothing else specifies one.  480 is Valve's
 * public Spacewar test app — achievements, stats, and callbacks
 * all work against it for anyone with a Steam account, which makes
 * it useful as a scaffolding placeholder.
 */
const SPACEWAR_APPID = 480;
const STEAM_APPID =
  Number.parseInt(process.env.TIAO_STEAM_APPID ?? "", 10) ||
  Number.parseInt(String(bakedMeta.steamAppId ?? ""), 10) ||
  SPACEWAR_APPID;

/**
 * `steamworks.js` client instance once initialized.  Kept module-local
 * so the rest of the file can check liveness with a simple truthy
 * check on `client`.
 *
 * @type {any}
 */
let client = null;

/**
 * Lazy-load `steamworks.js`.  Deferred so the native binding load
 * cost only hits Steam builds, and so a standalone build can ship
 * without the dependency present at all.  Returns null (never
 * throws) when the module or its prebuild is unavailable.
 *
 * @returns {any | null}
 */
function loadSteamworks() {
  if (!STEAM_ENABLED) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("steamworks.js");
  } catch (err) {
    console.warn("[steam] steamworks.js not available:", err);
    return null;
  }
}

/**
 * Steam's DRM relaunch check.  When the packaged game is started
 * directly (double-clicked from the install directory rather than
 * launched from the Steam library), this asks Steam to relaunch it
 * properly and reports that the current process should exit.
 *
 * MUST be called before `app.whenReady()` — the caller is expected
 * to quit immediately when this returns true, and quitting after a
 * window exists gives the user a visible flash-and-die.
 *
 * Only meaningful in a packaged build: during development the app
 * legitimately runs outside Steam, so the check is skipped rather
 * than fighting the dev loop.
 *
 * @param {boolean} isPackaged  `app.isPackaged` from the caller
 * @returns {boolean} true if the app should quit and let Steam relaunch it
 */
function maybeRestartForSteam(isPackaged) {
  if (!STEAM_ENABLED || !isPackaged) return false;
  const steamworks = loadSteamworks();
  if (!steamworks) return false;
  try {
    if (typeof steamworks.restartAppIfNecessary !== "function") return false;
    const shouldRestart = !!steamworks.restartAppIfNecessary(STEAM_APPID);
    if (shouldRestart) {
      console.info(`[steam] relaunching through Steam for appid ${STEAM_APPID}`);
    }
    return shouldRestart;
  } catch (err) {
    // A throw here means the SDK could not talk to Steam at all.
    // Carrying on unlaunched is strictly better than refusing to boot.
    console.warn("[steam] restartAppIfNecessary failed:", err);
    return false;
  }
}

/**
 * Install the Chromium switches Steam's in-game overlay needs, and
 * hook up the per-window frame invalidation it relies on.
 *
 * MUST be called before `app.whenReady()`.  `electronEnableSteamOverlay`
 * appends `in-process-gpu` and `disable-direct-composition` to the
 * command line, and Chromium parses its command line exactly once
 * during startup — appending later is silently ignored and the
 * overlay attaches without ever rendering.  See the module header.
 *
 * Best-effort: a failure here costs the overlay, not the app.
 *
 * @returns {boolean} true if the overlay hooks were installed
 */
function prepareSteamOverlay() {
  const steamworks = loadSteamworks();
  if (!steamworks) return false;
  try {
    if (typeof steamworks.electronEnableSteamOverlay !== "function") return false;
    steamworks.electronEnableSteamOverlay();
    return true;
  } catch (err) {
    console.warn("[steam] electronEnableSteamOverlay failed:", err);
    return false;
  }
}

/**
 * Open the Steamworks SDK connection.  Safe to call unconditionally
 * — silently returns when the Steam gate is off.  Call after
 * `app.whenReady()`; the pre-ready phases are separate functions
 * (see module header).
 *
 * @returns {boolean} true if Steam initialized successfully
 */
function initSteam() {
  if (!STEAM_ENABLED) return false;
  if (client) return true; // idempotent

  const steamworks = loadSteamworks();
  if (!steamworks) return false;

  // steamworks-rs sets SteamAppId/SteamGameId from the appid we pass
  // to init(), so the SDK does not need to find steam_appid.txt in
  // the process CWD.  That matters for packaged builds, where the
  // CWD is wherever the user launched from — often `/`.
  try {
    client = steamworks.init(STEAM_APPID);
    console.info(`[steam] initialized against appid ${STEAM_APPID}`);
  } catch (err) {
    console.warn(`[steam] init(${STEAM_APPID}) failed — is the Steam client running?`, err);
    client = null;
    return false;
  }

  // No callback pump here on purpose: steamworks.js starts its own
  // 30 Hz `runCallbacks` interval inside init() and destructures
  // `runCallbacks` off the object it hands back.  A second pump
  // would either double-dispatch or, as before, quietly call a
  // method that does not exist on the client.

  return true;
}

/**
 * Release the Steam client handle before the process exits.  Called
 * from main.cjs's before-quit handler.
 *
 * The callback interval belongs to steamworks.js, which clears it on
 * the next init(); there is nothing of ours to tear down beyond
 * dropping the reference.
 */
function shutdownSteam() {
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

/**
 * Batch-read the current unlock state of every achievement the caller
 * asks about. Used by the renderer on cold start to reconcile its
 * local "unlocked" cache against Steam's authoritative state — covers
 * the case where the user unlocked an achievement on another machine
 * (Steam Cloud sync) or directly via the Steam client UI.
 *
 * Returns an empty object when Steam isn't active so the renderer can
 * call this unconditionally without a separate isActive() guard.
 *
 * @param {string[]} apiNames
 * @returns {Record<string, boolean>}
 */
function getAchievementStates(apiNames) {
  /** @type {Record<string, boolean>} */
  const out = {};
  if (!client) return out;
  if (!Array.isArray(apiNames)) return out;
  for (const name of apiNames) {
    if (typeof name !== "string" || !name) continue;
    try {
      const ach = client.achievement;
      if (typeof ach?.isActivated === "function") {
        out[name] = !!ach.isActivated(name);
      } else {
        out[name] = false;
      }
    } catch (err) {
      console.warn(`[steam] isActivated(${name}) failed:`, err);
      out[name] = false;
    }
  }
  return out;
}

/**
 * Write integer stats and persist them to Steam in one shot.
 *
 * Stats are what drive the progress bars Steam shows on partially-completed
 * achievements ("37 / 100 games"). They are a separate mechanism from
 * unlocking: `unlockAchievement` never moves a bar, and setting a stat never
 * unlocks anything. Both have to happen.
 *
 * Batched deliberately. Steam buffers stat writes locally and only sends them
 * on `store()`, so setting three stats and storing once is one round trip to
 * Steam's servers instead of three. `store()` is also rate-limited by Valve,
 * which makes per-stat storing a bad habit at any scale.
 *
 * Values are floored to integers — every Tiao stat is a count, and Steam
 * rejects a float written to an INT stat.
 *
 * @param {Record<string, number>} stats  API name → value
 * @returns {{ ok: boolean; written: number; stored: boolean }}
 */
function setStats(stats) {
  if (!client) return { ok: false, written: 0, stored: false };
  if (!stats || typeof stats !== "object") return { ok: false, written: 0, stored: false };

  let written = 0;
  for (const [name, value] of Object.entries(stats)) {
    if (typeof name !== "string" || !name) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    try {
      if (typeof client.stats?.setInt === "function") {
        client.stats.setInt(name, Math.max(0, Math.floor(value)));
        written++;
      }
    } catch (err) {
      // One bad stat name shouldn't cost the others their write.
      console.warn(`[steam] setInt(${name}) failed:`, err);
    }
  }

  if (written === 0) return { ok: false, written: 0, stored: false };

  try {
    if (typeof client.stats?.store === "function") {
      client.stats.store();
      return { ok: true, written, stored: true };
    }
    return { ok: true, written, stored: false };
  } catch (err) {
    console.error("[steam] stats.store() failed:", err);
    return { ok: false, written, stored: false };
  }
}

/**
 * Steam overlay panel codes. The numeric values mirror the Steamworks
 * SDK's `EOverlayToStoreFlag` / dialog-name enum. We accept the named
 * string from the renderer (typo-safe, no magic numbers in renderer
 * code) and translate here.
 *
 * @type {Record<string, number>}
 */
const OVERLAY_DIALOG_CODES = {
  Friends: 0,
  Community: 1,
  Players: 2,
  Settings: 3,
  OfficialGameGroup: 4,
  Stats: 5,
  Achievements: 6,
};

/**
 * Open one of Steam's named overlay panels (Friends, Achievements,
 * Stats, etc.). No-op when Steam isn't active; returns false so the
 * renderer can fall back to an in-app fallback dialog instead of
 * silently doing nothing.
 *
 * @param {string} dialog
 * @returns {boolean}
 */
function openOverlay(dialog) {
  if (!client) return false;
  const code = OVERLAY_DIALOG_CODES[dialog];
  if (code == null) return false;
  try {
    const overlay = client.overlay;
    if (typeof overlay?.activateDialog === "function") {
      overlay.activateDialog(code);
      return true;
    }
    return false;
  } catch (err) {
    console.warn(`[steam] openOverlay(${dialog}) failed:`, err);
    return false;
  }
}

/**
 * Open the Steam overlay's in-game web browser to an arbitrary URL.
 * Useful for store pages, news posts, community guides — anything you
 * want the player to see without leaving the game.
 *
 * @param {string} url
 * @returns {boolean}
 */
function openOverlayUrl(url) {
  if (!client) return false;
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return false;
  try {
    const overlay = client.overlay;
    if (typeof overlay?.activateToWebPage === "function") {
      overlay.activateToWebPage(url);
      return true;
    }
    return false;
  } catch (err) {
    console.warn(`[steam] openOverlayUrl(${url}) failed:`, err);
    return false;
  }
}

module.exports = {
  STEAM_ENABLED,
  STEAM_APPID,
  OVERLAY_DIALOG_CODES,
  maybeRestartForSteam,
  prepareSteamOverlay,
  initSteam,
  shutdownSteam,
  isSteamActive,
  getSteamUser,
  unlockAchievement,
  indicateAchievementProgress,
  getAchievementStates,
  setStats,
  openOverlay,
  openOverlayUrl,
};
