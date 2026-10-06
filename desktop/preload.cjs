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
  isSteamBuild: readArgValue("--tiao-steam-build=") === "1",
  distributionChannel:
    readArgValue("--tiao-distribution-channel=") ||
    (readArgValue("--tiao-steam-build=") === "1" ? "steam" : "direct"),
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
    /**
     * True in a Steam-distributed build. Distinct from
     * `steam.isActive()`: this reflects how the binary was packaged,
     * not whether the Steam client is currently reachable, and it is
     * readable synchronously. Use it to gate anything Valve's rules
     * forbid in a Steam build (external payment flows, self-updates)
     * — those must stay hidden even when Steam isn't running.
     */
    isSteamBuild: runtimeConfig.isSteamBuild,
    /**
     * Storefront that shipped this binary: "direct" | "itch" | "steam" |
     * "mas" | "msstore". Store channels own updates and payments.
     */
    distributionChannel: runtimeConfig.distributionChannel,
  }),

  auth: {
    /**
     * @param {"github"|"google"|"discord"|"apple"} provider
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
      const listener = (/** @type {unknown} */ _event, /** @type {{ reason: string }} */ payload) =>
        cb(payload);
      ipcRenderer.on("auth:error", listener);
      return () => ipcRenderer.off("auth:error", listener);
    },
  },

  /**
   * Steamworks integration — only non-null in the Steam build
   * variant (`STEAM_BUILD=true` at launch). Standalone / itch.io
   * builds return `isActive: false` from every call and renderer
   * code should gracefully degrade instead of rendering Steam-
   * specific UI.
   *
   * The API names passed to `unlockAchievement` /
   * `indicateAchievementProgress` are the internal Steamworks
   * Partner Portal identifiers (not the localised display labels)
   * — e.g. "ACH_FIRST_WIN", not "First Victory".  The canonical
   * list should live in `shared/src/achievements.ts` once Tiao's
   * Partner Portal entry is live.
   */
  /**
   * Microsoft Store add-on purchases — functional only in the msstore
   * (AppX) build; every call degrades to "unavailable" elsewhere.
   */
  msstore: {
    /** @returns {Promise<boolean>} */
    isAvailable: () => ipcRenderer.invoke("msstore:isAvailable"),

    /**
     * The Store's listing of our Durable add-ons, with localized prices.
     *
     * @returns {Promise<Array<{ storeId: string; inAppOfferToken: string; title: string; formattedPrice: string; isInUserCollection: boolean }>>}
     */
    getAddOns: () => ipcRenderer.invoke("msstore:getAddOns"),

    /**
     * Show the Store purchase dialog for an add-on, by its Partner Center
     * Product ID (InAppOfferToken).
     *
     * @param {string} offerToken
     * @returns {Promise<{ status: string; extendedError?: string }>}
     */
    purchase: (offerToken) => ipcRenderer.invoke("msstore:purchase", offerToken),

    /**
     * Microsoft Store ID key for the signed-in Store user, for the API
     * server's Collections API call. null when unavailable.
     *
     * @param {string} serviceTicket
     * @param {string} publisherUserId
     * @returns {Promise<string | null>}
     */
    getCollectionsId: (serviceTicket, publisherUserId) =>
      ipcRenderer.invoke("msstore:getCollectionsId", serviceTicket, publisherUserId),
  },

  /**
   * Mac App Store In-App Purchase (StoreKit 1). `isAvailable()` is
   * false outside a Mac App Store build. See desktop/src/inAppPurchase.cjs
   * for the purchase → verify → finish flow.
   */
  iap: {
    /**
     * True in a Mac App Store build. Synchronous so the renderer can
     * pick the payment path during render; the sandboxed preload's
     * `process` exposes `mas`.
     */
    isMasBuild: process.mas === true,
    /** @returns {Promise<boolean>} */
    isAvailable: () => ipcRenderer.invoke("iap:isAvailable"),
    /** @param {string[]} productIds */
    getProducts: (productIds) => ipcRenderer.invoke("iap:getProducts", productIds),
    /**
     * Queues a payment. The outcome arrives through onTransactions.
     * @param {string} productId
     * @param {string} appAccountToken
     */
    purchase: (productId, appAccountToken) =>
      ipcRenderer.invoke("iap:purchase", productId, appAccountToken),
    /** Asks StoreKit to replay past purchases through onTransactions. */
    restore: () => ipcRenderer.invoke("iap:restore"),
    /** Purchased / restored transactions not yet finished. */
    getPendingTransactions: () => ipcRenderer.invoke("iap:getPendingTransactions"),
    /** @param {string} transactionId */
    finishTransaction: (transactionId) =>
      ipcRenderer.invoke("iap:finishTransaction", transactionId),
    /**
     * @param {(transactions: unknown[]) => void} cb
     * @returns {() => void}
     */
    onTransactions: (cb) => {
      const listener = (/** @type {unknown} */ _event, /** @type {unknown[]} */ transactions) =>
        cb(transactions);
      ipcRenderer.on("iap:transactions", listener);
      return () => ipcRenderer.off("iap:transactions", listener);
    },
  },

  steam: {
    /** @returns {Promise<boolean>} */
    isActive: () => ipcRenderer.invoke("steam:isActive"),

    /** @returns {Promise<{ steamId: string; displayName: string; country?: string } | null>} */
    getUser: () => ipcRenderer.invoke("steam:getUser"),

    /**
     * @param {string} apiName
     * @returns {Promise<{ ok: true } | { ok: false; reason: string }>}
     */
    unlockAchievement: (apiName) => ipcRenderer.invoke("steam:unlockAchievement", apiName),

    /**
     * @param {string} apiName
     * @param {number} current
     * @param {number} max
     * @returns {Promise<{ ok: true } | { ok: false; reason: string }>}
     */
    indicateAchievementProgress: (apiName, current, max) =>
      ipcRenderer.invoke("steam:indicateAchievementProgress", apiName, current, max),

    /**
     * Batch-read the unlock state of the given achievements. Returns
     * an empty object when Steam isn't active so callers can use the
     * result unconditionally.
     *
     * @param {string[]} apiNames
     * @returns {Promise<Record<string, boolean>>}
     */
    getAchievementStates: (apiNames) => ipcRenderer.invoke("steam:getAchievementStates", apiNames),

    /**
     * Write integer stats and persist them, e.g.
     * `{ STAT_GAMES_PLAYED: 37 }`. These drive the progress bars Steam
     * draws on partly-completed achievements; unlocking is separate.
     *
     * @param {Record<string, number>} stats
     * @returns {Promise<{ ok: boolean; written: number; stored: boolean }>}
     */
    setStats: (stats) => ipcRenderer.invoke("steam:setStats", stats),

    /**
     * Activate one of Steam's named overlay panels. Returns false when
     * Steam isn't active or the dialog name is unrecognized so the
     * renderer can fall back to an in-app dialog.
     *
     * @param {"Friends"|"Community"|"Players"|"Settings"|"OfficialGameGroup"|"Stats"|"Achievements"} dialog
     * @returns {Promise<boolean>}
     */
    openOverlay: (dialog) => ipcRenderer.invoke("steam:openOverlay", dialog),

    /**
     * Open the Steam overlay's web browser to an http(s) URL. No-op
     * (returns false) for non-http URLs or when Steam isn't active.
     *
     * @param {string} url
     * @returns {Promise<boolean>}
     */
    openOverlayUrl: (url) => ipcRenderer.invoke("steam:openOverlayUrl", url),

    /**
     * Hex-encoded Web API auth ticket for Steam Microtransactions. The
     * API server resolves it to the buyer's SteamID; null when Steam
     * isn't active.
     *
     * @returns {Promise<string | null>}
     */
    getWebApiTicket: () => ipcRenderer.invoke("steam:getWebApiTicket"),

    /**
     * Subscribe to the overlay's purchase decision for a pending order
     * (MicroTxnAuthorizationResponse). Returns an unsubscribe function.
     *
     * @param {(event: { appId: number; orderId: string; authorized: boolean }) => void} cb
     * @returns {() => void}
     */
    onMicroTxnAuthorization: (cb) => {
      const listener = (
        /** @type {unknown} */ _event,
        /** @type {{ appId: number; orderId: string; authorized: boolean }} */ payload,
      ) => cb(payload);
      ipcRenderer.on("steam:microTxnAuthorization", listener);
      return () => ipcRenderer.off("steam:microTxnAuthorization", listener);
    },
  },
});
