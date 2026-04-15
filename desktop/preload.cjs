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

contextBridge.exposeInMainWorld("electron", {
  isElectron: true,
  platform: process.platform,
  version: process.env.TIAO_DESKTOP_VERSION || "dev",

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
});
