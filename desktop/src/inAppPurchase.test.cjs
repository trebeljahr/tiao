// @ts-check
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createInAppPurchaseBridge } = require("./inAppPurchase.cjs");

const TOKEN = "0f9a3c1e-2b4d-5e6f-8a9b-0c1d2e3f4a5b";
const PRODUCT = "com.ricoslabs.tiao.badge.supporter";

function fakeStoreKit() {
  /** @type {((event: unknown, txs: any[]) => void) | null} */
  let listener = null;
  const calls = /** @type {{ method: string; args: unknown[] }[]} */ ([]);
  return {
    calls,
    fire: (/** @type {any[]} */ txs) => listener?.({}, txs),
    storeKit: {
      canMakePayments: () => true,
      getProducts: async (/** @type {string[]} */ ids) =>
        ids.map((id) => ({
          productIdentifier: id,
          localizedTitle: "Supporter",
          localizedDescription: "Gold badge",
          price: 2.99,
          formattedPrice: "$2.99",
          currencyCode: "USD",
        })),
      purchaseProduct: async (/** @type {string} */ id, /** @type {unknown} */ opts) => {
        calls.push({ method: "purchaseProduct", args: [id, opts] });
        return true;
      },
      restoreCompletedTransactions: () => calls.push({ method: "restore", args: [] }),
      finishTransactionByDate: (/** @type {string} */ date) =>
        calls.push({ method: "finish", args: [date] }),
      on: (/** @type {string} */ _event, /** @type {any} */ cb) => {
        listener = cb;
      },
    },
  };
}

describe("Mac App Store IAP bridge", () => {
  test("is unavailable outside a Mac App Store build", async () => {
    const iap = createInAppPurchaseBridge({ enabled: false, storeKit: null, emit: () => {} });
    assert.equal(iap.isAvailable(), false);
    assert.deepEqual(await iap.getProducts([PRODUCT]), []);
    assert.deepEqual(await iap.purchase(PRODUCT, TOKEN), { ok: false, reason: "unavailable" });
  });

  test("passes the account token to StoreKit as applicationUsername", async () => {
    const fake = fakeStoreKit();
    const iap = createInAppPurchaseBridge({
      enabled: true,
      storeKit: fake.storeKit,
      emit: () => {},
    });
    assert.deepEqual(await iap.purchase(PRODUCT, TOKEN), { ok: true });
    assert.deepEqual(fake.calls[0], {
      method: "purchaseProduct",
      args: [PRODUCT, { quantity: 1, username: TOKEN }],
    });
  });

  test("rejects foreign product ids and malformed tokens", async () => {
    const fake = fakeStoreKit();
    const iap = createInAppPurchaseBridge({
      enabled: true,
      storeKit: fake.storeKit,
      emit: () => {},
    });
    assert.equal((await iap.purchase("com.evil.app.item", TOKEN)).ok, false);
    assert.equal((await iap.purchase(PRODUCT, "not-a-uuid")).ok, false);
    assert.deepEqual(
      await iap.getProducts(["com.evil.app.item", PRODUCT]).then((p) => p.length),
      1,
    );
    assert.equal(fake.calls.length, 0);
  });

  test("keeps purchased transactions pending until the renderer finishes them", () => {
    const fake = fakeStoreKit();
    /** @type {unknown[][]} */
    const emitted = [];
    const iap = createInAppPurchaseBridge({
      enabled: true,
      storeKit: fake.storeKit,
      emit: (txs) => emitted.push(txs),
    });

    fake.fire([
      {
        transactionIdentifier: "2000000111",
        originalTransactionIdentifier: "2000000100",
        transactionState: "purchased",
        transactionDate: "2026-10-05T00:00:00Z",
        payment: { productIdentifier: PRODUCT, quantity: 1 },
      },
      {
        transactionIdentifier: "",
        transactionState: "failed",
        transactionDate: "2026-10-05T00:00:01Z",
        errorCode: 2,
        errorMessage: "cancelled",
        payment: { productIdentifier: PRODUCT, quantity: 1 },
      },
    ]);

    assert.equal(emitted.length, 1);
    assert.deepEqual(
      iap
        .getPendingTransactions()
        .map((t) => [t.transactionId, t.originalTransactionId, t.productId]),
      [["2000000111", "2000000100", PRODUCT]],
    );
    // The failed one is cleared straight away; the purchase is not.
    assert.deepEqual(fake.calls, [{ method: "finish", args: ["2026-10-05T00:00:01Z"] }]);

    assert.equal(iap.finishTransaction("2000000111"), true);
    assert.deepEqual(fake.calls[1], { method: "finish", args: ["2026-10-05T00:00:00Z"] });
    assert.deepEqual(iap.getPendingTransactions(), []);
    assert.equal(iap.finishTransaction("2000000111"), false);
  });
});
