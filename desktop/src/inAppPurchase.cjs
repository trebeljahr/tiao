// @ts-check
/**
 * Mac App Store In-App Purchase bridge.
 *
 * Apple guideline 3.1.1: the Mac App Store build must sell badges,
 * themes and the Patron subscription through In-App Purchase, not
 * Stripe. Electron's `inAppPurchase` module wraps StoreKit 1, which
 * hands us transaction ids but never a signed JWS, so the renderer
 * sends the id to the server (`POST /api/shop/apple/verify`) and the
 * server fetches the signed transaction from the App Store Server API.
 *
 * Flow:
 *   1. renderer: `iap.purchase(productId, appAccountToken)` queues the
 *      payment. The token goes in as StoreKit's applicationUsername,
 *      which Apple reports as appAccountToken.
 *   2. StoreKit fires `transactions-updated`; purchased / restored
 *      transactions are kept in `pending` and pushed to the renderer.
 *   3. renderer verifies with the server, then calls
 *      `iap.finishTransaction(id)`. Unfinished transactions stay in
 *      StoreKit's queue and come back on the next launch, so a crash
 *      between payment and verification never loses a purchase.
 *
 * Only active in a Mac App Store build (`process.mas`). Everywhere else
 * `isAvailable()` is false and the shop keeps using Stripe (or stays
 * hidden on other store channels).
 */

/**
 * @typedef {{
 *   transactionId: string;
 *   originalTransactionId: string | null;
 *   productId: string;
 *   state: "purchased" | "restored" | "failed" | "deferred" | "purchasing";
 *   transactionDate: string | null;
 *   errorCode: number | null;
 *   errorMessage: string | null;
 * }} IapTransaction
 */

/**
 * @typedef {{
 *   canMakePayments: () => boolean;
 *   getProducts: (ids: string[]) => Promise<Array<Record<string, any>>>;
 *   purchaseProduct: (id: string, opts?: { quantity?: number; username?: string }) => Promise<boolean>;
 *   restoreCompletedTransactions: () => void;
 *   finishTransactionByDate: (date: string) => void;
 *   on: (event: "transactions-updated", cb: (event: any, txs: Array<any>) => void) => unknown;
 * }} StoreKitLike
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCT_ID_RE = /^com\.ricoslabs\.tiao\.[a-z0-9.-]+$/;

/**
 * @param {Record<string, any>} tx Electron.Transaction
 * @returns {IapTransaction}
 */
function toIapTransaction(tx) {
  return {
    transactionId: String(tx.transactionIdentifier ?? ""),
    originalTransactionId: tx.originalTransactionIdentifier
      ? String(tx.originalTransactionIdentifier)
      : null,
    productId: String(tx.payment?.productIdentifier ?? ""),
    state: tx.transactionState,
    transactionDate: tx.transactionDate ?? null,
    errorCode: typeof tx.errorCode === "number" ? tx.errorCode : null,
    errorMessage: tx.errorMessage || null,
  };
}

/**
 * @param {{
 *   enabled: boolean;
 *   storeKit: StoreKitLike | null;
 *   emit: (transactions: IapTransaction[]) => void;
 * }} options
 */
function createInAppPurchaseBridge({ enabled, storeKit, emit }) {
  /** @type {Map<string, IapTransaction>} */
  const pending = new Map();
  const active = Boolean(enabled && storeKit);

  if (active && storeKit) {
    storeKit.on("transactions-updated", (_event, transactions) => {
      const updates = transactions.map(toIapTransaction);
      for (const tx of updates) {
        if ((tx.state === "purchased" || tx.state === "restored") && tx.transactionId) {
          pending.set(tx.transactionId, tx);
        } else if (tx.state === "failed" && tx.transactionDate) {
          // Failed transactions carry nothing to verify; clear them
          // from the queue right away.
          storeKit.finishTransactionByDate(tx.transactionDate);
        }
      }
      emit(updates);
    });
  }

  return {
    /** @returns {boolean} */
    isAvailable() {
      return active && storeKit !== null && storeKit.canMakePayments();
    },

    /** @param {unknown} productIds */
    async getProducts(productIds) {
      if (!active || !storeKit || !Array.isArray(productIds)) return [];
      const ids = productIds.filter((id) => typeof id === "string" && PRODUCT_ID_RE.test(id));
      const products = await storeKit.getProducts(ids);
      return products.map((p) => ({
        productId: String(p.productIdentifier),
        title: String(p.localizedTitle ?? ""),
        description: String(p.localizedDescription ?? ""),
        price: typeof p.price === "number" ? p.price : null,
        formattedPrice: typeof p.formattedPrice === "string" ? p.formattedPrice : null,
        currencyCode: typeof p.currencyCode === "string" ? p.currencyCode : null,
      }));
    },

    /**
     * @param {unknown} productId
     * @param {unknown} appAccountToken
     * @returns {Promise<{ ok: true } | { ok: false; reason: string }>}
     */
    async purchase(productId, appAccountToken) {
      if (!active || !storeKit) return { ok: false, reason: "unavailable" };
      if (typeof productId !== "string" || !PRODUCT_ID_RE.test(productId)) {
        return { ok: false, reason: "invalid_product" };
      }
      if (typeof appAccountToken !== "string" || !UUID_RE.test(appAccountToken)) {
        return { ok: false, reason: "invalid_account_token" };
      }
      if (!storeKit.canMakePayments()) return { ok: false, reason: "payments_disabled" };
      const queued = await storeKit.purchaseProduct(productId, {
        quantity: 1,
        username: appAccountToken,
      });
      return queued ? { ok: true } : { ok: false, reason: "invalid_product" };
    },

    restore() {
      if (active && storeKit) storeKit.restoreCompletedTransactions();
    },

    /** @returns {IapTransaction[]} */
    getPendingTransactions() {
      return [...pending.values()];
    },

    /** @param {unknown} transactionId */
    finishTransaction(transactionId) {
      if (!active || !storeKit || typeof transactionId !== "string") return false;
      const tx = pending.get(transactionId);
      if (!tx?.transactionDate) return false;
      storeKit.finishTransactionByDate(tx.transactionDate);
      pending.delete(transactionId);
      return true;
    },
  };
}

module.exports = { createInAppPurchaseBridge, toIapTransaction };
