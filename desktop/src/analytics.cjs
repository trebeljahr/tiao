// @ts-check
/**
 * Thin OpenPanel wrapper for the Electron main process.
 *
 * The Tiao web client already tracks usage events via OpenPanel
 * (see client/src/lib/openpanel.ts) — what this module adds is
 * visibility into events that only happen in the main process,
 * which the renderer can't see:
 *
 *   - `desktop:app_start` — cold start, packaged vs dev flag
 *   - `desktop:auth_flow_start` / `complete` / `failed` — OAuth
 *     bridge telemetry from authBridge.cjs
 *   - `desktop:deep_link_received` — incoming tiao:// URL from
 *     the OS, useful for debugging cross-platform delivery
 *   - `desktop:external_link_opened` — shell.openExternal usage
 *
 * Privacy:
 *
 *   - Starts DISABLED on first launch.  Users have to explicitly
 *     opt in via the in-renderer consent banner, which calls
 *     `analytics.setEnabled(true)` through the preload bridge.
 *     The flag is persisted to a plain JSON file under
 *     `app.getPath("userData")` so the decision survives restarts.
 *   - The first-launch `desktop:app_start` event is therefore
 *     suppressed until consent is granted.  Subsequent launches
 *     honor the stored flag immediately.
 *   - A stable anonymous deviceId is generated on first launch
 *     and kept in the same prefs file.  It is NOT tied to the
 *     user's account — profile identification happens in the
 *     renderer via the web SDK.
 *
 * No external dependencies: we POST raw JSON to OpenPanel's track
 * endpoint via the global `fetch` available in Electron's main
 * process (Node 20+).  If the env vars are unset, the module
 * initializes in no-op mode.
 */

const { app } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");

const PREFS_FILE = "tiao-analytics.json";

// Build-time env vars passed via electron-builder's extraMetadata /
// scripts/release.sh when the maintainer produces a release.  In
// development these are empty strings, which trips the early-return
// in `track()` and keeps the dev session clean.
const OPENPANEL_CLIENT_ID = process.env.TIAO_OPENPANEL_CLIENT_ID || "";
const OPENPANEL_API_URL =
  process.env.TIAO_OPENPANEL_API_URL || "https://analytics-api.trebeljahr.com";
const APP_VERSION = process.env.TIAO_DESKTOP_VERSION || "dev";

/**
 * @typedef {{ enabled: boolean; deviceId: string }} AnalyticsPrefs
 */

/** @type {AnalyticsPrefs} */
let prefs = { enabled: false, deviceId: "" };

function getPrefsFilePath() {
  return path.join(app.getPath("userData"), PREFS_FILE);
}

/**
 * Load or initialize the persisted analytics prefs.  Called once by
 * main.cjs during bootstrap.  Creates a fresh deviceId on first
 * launch.
 */
function initAnalytics() {
  try {
    const file = getPrefsFilePath();
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      if (typeof raw === "object" && raw) {
        prefs = {
          enabled: raw.enabled === true,
          deviceId: typeof raw.deviceId === "string" ? raw.deviceId : randomUUID(),
        };
      }
    } else {
      prefs = { enabled: false, deviceId: randomUUID() };
      persistPrefs();
    }
  } catch (err) {
    console.error("[analytics] failed to load prefs:", err);
    prefs = { enabled: false, deviceId: randomUUID() };
  }
}

function persistPrefs() {
  try {
    const file = getPrefsFilePath();
    fs.writeFileSync(file, JSON.stringify(prefs, null, 2) + "\n", { mode: 0o600 });
  } catch (err) {
    console.error("[analytics] failed to persist prefs:", err);
  }
}

/**
 * Update the opt-in flag.  Called by the renderer via IPC when the
 * OpenPanel consent banner is accepted or revoked.
 *
 * @param {boolean} enabled
 */
function setEnabled(enabled) {
  const next = !!enabled;
  if (prefs.enabled === next) return;
  prefs.enabled = next;
  persistPrefs();
}

function isEnabled() {
  return prefs.enabled;
}

/**
 * Emit an event to OpenPanel.  Honors the opt-in flag and the
 * env-var availability check — both must be true for the network
 * call to happen.  Fire-and-forget; errors are logged and swallowed
 * so a dead analytics endpoint never blocks a real user action.
 *
 * @param {string} name
 * @param {Record<string, unknown>} [properties]
 */
function track(name, properties = {}) {
  if (!prefs.enabled) return;
  if (!OPENPANEL_CLIENT_ID) return;

  const payload = {
    type: "track",
    payload: {
      name,
      properties: {
        ...properties,
        platform: "desktop",
        os: process.platform,
        app_version: APP_VERSION,
      },
      deviceId: prefs.deviceId,
    },
  };

  // Raw fetch — no SDK dependency.  Uses the OpenPanel ingestion
  // endpoint at /track.  Node 20+ has global fetch.
  //
  // 5s timeout via AbortSignal: Node's global fetch has no built-in
  // timeout, so a slow or down ingest endpoint would otherwise leave
  // the connection hanging until the OS TCP timeout (~120s on macOS).
  // That doesn't block any user action because we `void` the promise,
  // but it accumulates open sockets over time on a long-running
  // session.  5s is generous for a fire-and-forget event.
  const url = `${OPENPANEL_API_URL.replace(/\/$/, "")}/track`;
  void fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "openpanel-client-id": OPENPANEL_CLIENT_ID,
      "user-agent": `TiaoDesktop/${APP_VERSION} (${process.platform})`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  }).catch((err) => {
    console.warn(`[analytics] track(${name}) failed:`, err);
  });
}

module.exports = {
  initAnalytics,
  setEnabled,
  isEnabled,
  track,
};
