// @ts-check
/**
 * Shared runtime configuration helpers for the desktop main process.
 *
 * Exists so main.cjs (which passes the API URL into the preload bridge
 * for the renderer) and authBridge.cjs (which calls the API directly
 * from the main process to exchange OAuth codes for bearer tokens)
 * pick up the SAME resolved URL from a single source.  Without this
 * they'd duplicate the env + default logic and could drift.
 */

const { app } = require("electron");

/**
 * Resolve the Tiao API base URL at launch time from the environment.
 *
 * Precedence:
 *   1. `TIAO_API_URL` env var (set by the user, the dev npm scripts,
 *      or the release script)
 *   2. Default: `http://localhost:5005` for unpackaged dev builds
 *      (matches the tiao server's dev port), `https://api.playtiao.com`
 *      for packaged builds.
 *
 * Used both for the renderer's base URL (passed through the preload
 * bridge on `window.electron.config.apiUrl`) and for main-process API
 * calls in authBridge.cjs's OAuth exchange path.  Keeping them in sync
 * is why this helper exists.
 *
 * @returns {string}
 */
function resolveApiUrl() {
  const fromEnv = process.env.TIAO_API_URL;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return app.isPackaged ? "https://api.playtiao.com" : "http://localhost:5005";
}

module.exports = { resolveApiUrl };
