// @ts-check
/**
 * Preload script — runs BEFORE any renderer code, with access to a
 * privileged subset of Node APIs.  The `contextBridge` pattern below
 * exposes a narrow, read-only surface on `window.electron` that the
 * renderer (the Next.js static bundle) can use without granting it
 * direct `require()` access.
 *
 * The auth surface matches the shape that client/src/lib/api.ts and
 * client/src/lib/AuthContext.tsx cast `window.electron` to — any
 * change here needs a matching change over in the renderer.
 *
 * IPC contract:
 *   - `auth:startOAuth(provider)` → opens the system browser at
 *     /api/auth/desktop/start. Returns { ok: true } or
 *     { ok: false, reason }. The renderer doesn't await the actual
 *     auth completion — that arrives via the `auth:complete`
 *     broadcast when the tiao:// deep link fires.
 *   - `auth:getToken()` → returns the currently-cached bearer token
 *     (string | null). Safe to call on cold start.
 *   - `auth:logout()` → clears the persisted encrypted token file
 *     and the in-memory cache.
 *
 * Broadcasts (from main → all renderer windows):
 *   - `auth:complete { sessionToken, userId, expiresAt }`
 *   - `auth:error    { reason }`
 */

const { contextBridge, ipcRenderer } = require("electron");

/**
 * Runtime config injected by main.cjs via BrowserWindow's
 * `webPreferences.additionalArguments` option.  The shape matches
 * `buildAdditionalArguments()` in desktop/src/window.cjs — each entry
 * arrives as a `--tiao-<key>=<value>` string in `process.argv`.
 *
 * `apiUrl` is the Tiao HTTP API base URL (e.g. `https://api.playtiao.com`
 * or `http://localhost:5005` in dev).  Exposing it via the bridge
 * means the renderer can switch between local / staging / production
 * APIs WITHOUT rebuilding the static export — only an Electron
 * relaunch with a different `TIAO_API_URL` env var is needed.
 *
 * Also used by `client/src/lib/api.ts` to build both the REST and
 * WebSocket base URLs.  A falsy value is tolerated: the renderer
 * falls back to the build-time inlined `NEXT_PUBLIC_DESKTOP_API_URL`
 * as a safety net.
 */
/**
 * @param {string} prefix
 * @returns {string | null}
 */
function readArgValue(prefix) {
  const hit = process.argv.find((arg) => typeof arg === "string" && arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}
const runtimeConfig = {
  apiUrl: readArgValue("--tiao-api-url=") || "",
};

contextBridge.exposeInMainWorld("electron", {
  isElectron: true,
  platform: process.platform,
  version: process.env.TIAO_DESKTOP_VERSION || "dev",

  /**
   * Runtime config injected by main.cjs.  Synchronous reads only —
   * the renderer can call `window.electron.config.apiUrl` at module
   * load time without waiting for any IPC round-trip.  Values are
   * frozen at preload time and never change for the life of the
   * window.
   */
  config: Object.freeze({
    apiUrl: runtimeConfig.apiUrl,
  }),

  auth: {
    /**
     * @param {"github"|"google"|"discord"} provider
     * @returns {Promise<{ ok: true } | { ok: false; reason: string }>}
     */
    startOAuth: (provider) => ipcRenderer.invoke("auth:startOAuth", provider),

    /** @returns {Promise<string | null>} */
    getToken: () => ipcRenderer.invoke("auth:getToken"),

    /** @returns {Promise<{ ok: true }>} */
    logout: () => ipcRenderer.invoke("auth:logout"),

    /**
     * Returns whether the OS provides credential encryption for
     * persisting the bearer token across app restarts.
     *
     * The renderer should call this once on bootstrap and, if
     * `available === false`, surface a one-time toast explaining
     * that the user will be signed out on every restart.  This is
     * almost always a Linux machine missing libsecret-1-0; macOS
     * and Windows ship with the relevant providers.
     *
     * @returns {Promise<{ available: boolean }>}
     */
    getPersistenceStatus: () => ipcRenderer.invoke("auth:getPersistenceStatus"),

    /**
     * Subscribe to auth-complete events fired after a successful
     * OAuth exchange.  Returns an unsubscribe function.
     *
     * @param {(payload: { sessionToken: string; userId: string; expiresAt: number }) => void} cb
     * @returns {() => void}
     */
    onAuthComplete: (cb) => {
      const listener = (
        /** @type {unknown} */ _event,
        /** @type {{ sessionToken: string; userId: string; expiresAt: number }} */ payload,
      ) => cb(payload);
      ipcRenderer.on("auth:complete", listener);
      return () => ipcRenderer.off("auth:complete", listener);
    },

    /**
     * Subscribe to auth-error events fired when the deep-link
     * exchange fails (state mismatch, network error, 401).
     *
     * @param {(payload: { reason: string }) => void} cb
     * @returns {() => void}
     */
    onAuthError: (cb) => {
      const listener = (
        /** @type {unknown} */ _event,
        /** @type {{ reason: string }} */ payload,
      ) => cb(payload);
      ipcRenderer.on("auth:error", listener);
      return () => ipcRenderer.off("auth:error", listener);
    },
  },

  analytics: {
    /**
     * Toggle main-process OpenPanel tracking on or off.  The renderer
     * calls this whenever the user accepts / revokes the web
     * OpenPanel consent banner so main-process events stay in sync
     * with the user's stated preference.
     *
     * @param {boolean} enabled
     * @returns {Promise<{ ok: true }>}
     */
    setEnabled: (enabled) => ipcRenderer.invoke("analytics:setEnabled", enabled),
  },
});
