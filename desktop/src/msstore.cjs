// @ts-check
/**
 * Microsoft Store in-app purchases for the `msstore` (AppX/MSIX) build.
 *
 * Windows.Services.Store has no JavaScript projection in Electron, so the
 * calls go through a small N-API addon in native/msstore (C++/WinRT). The
 * addon is built only by the msstore CI leg, against Electron's headers,
 * and packaged only into the AppX — every other channel and every other
 * OS sees `isMsStoreAvailable() === false` and the addon is never loaded.
 *
 * Purchase flow (the server never trusts the renderer about ownership):
 *
 *   1. getAddOns()          — the Store's view of our Durable add-ons. Maps
 *                             the developer-chosen InAppOfferToken (what the
 *                             server catalog knows) to the Store ID Partner
 *                             Center assigned (what RequestPurchaseAsync wants).
 *   2. purchase(token, hwnd) — Store purchase dialog, parented to our window.
 *   3. getCollectionsId(serviceTicket, playerId)
 *                           — a Microsoft Store ID key for the signed-in
 *                             Store user; the API server spends it on the
 *                             Collections API to see what that user owns.
 */

const path = require("node:path");

/**
 * @typedef {{
 *   storeId: string;
 *   inAppOfferToken: string;
 *   title: string;
 *   formattedPrice: string;
 *   isInUserCollection: boolean;
 * }} MsStoreAddOn
 *
 * @typedef {"succeeded" | "alreadyPurchased" | "notPurchased" | "networkError" | "serverError"} MsStorePurchaseStatus
 *
 * @typedef {{
 *   getAddOns(): Promise<MsStoreAddOn[]>;
 *   requestPurchase(storeId: string, hwnd: Buffer): Promise<{ status: MsStorePurchaseStatus; extendedError: string }>;
 *   getCustomerCollectionsId(serviceTicket: string, publisherUserId: string): Promise<string>;
 * }} MsStoreAddon
 */

const ADDON_PATH = path.join(
  __dirname,
  "..",
  "native",
  "msstore",
  "build",
  "Release",
  "tiao_msstore.node",
);

/**
 * @param {{ channel: string; platform: string; load?: () => MsStoreAddon }} input
 */
function createMsStoreBridge({ channel, platform, load }) {
  const enabled = channel === "msstore" && platform === "win32";
  /** @type {MsStoreAddon | null | undefined} undefined = not tried yet */
  let addon;

  /** @returns {MsStoreAddon | null} */
  function getAddon() {
    if (!enabled) return null;
    if (addon !== undefined) return addon;
    try {
      // Electron redirects app.asar paths to app.asar.unpacked for .node files.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      addon = load ? load() : /** @type {MsStoreAddon} */ (require(ADDON_PATH));
    } catch (err) {
      console.warn("[msstore] native bridge unavailable:", err);
      addon = null;
    }
    return addon;
  }

  /** @type {Map<string, MsStoreAddOn> | null} */
  let addOnsByToken = null;

  /** @returns {Promise<MsStoreAddOn[]>} */
  async function getAddOns() {
    const a = getAddon();
    if (!a) return [];
    const list = await a.getAddOns();
    addOnsByToken = new Map(
      list.filter((x) => x.inAppOfferToken).map((x) => [x.inAppOfferToken, x]),
    );
    return list;
  }

  /**
   * @param {string} offerToken  catalog `msStoreOfferToken`
   * @param {Buffer} hwnd        BrowserWindow.getNativeWindowHandle()
   * @returns {Promise<{ status: MsStorePurchaseStatus | "unavailable" | "unknownProduct"; extendedError?: string }>}
   */
  async function purchase(offerToken, hwnd) {
    const a = getAddon();
    if (!a) return { status: "unavailable" };
    if (!addOnsByToken?.has(offerToken)) await getAddOns();
    const product = addOnsByToken?.get(offerToken);
    if (!product) return { status: "unknownProduct" };
    return a.requestPurchase(product.storeId, hwnd);
  }

  /**
   * @param {string} serviceTicket  Entra token (collections key audience) from the API
   * @param {string} publisherUserId  Tiao player id, embedded in the key
   * @returns {Promise<string | null>}
   */
  async function getCollectionsId(serviceTicket, publisherUserId) {
    const a = getAddon();
    if (!a) return null;
    return a.getCustomerCollectionsId(serviceTicket, publisherUserId);
  }

  return {
    isAvailable: () => getAddon() !== null,
    getAddOns,
    purchase,
    getCollectionsId,
  };
}

module.exports = { createMsStoreBridge, ADDON_PATH };
