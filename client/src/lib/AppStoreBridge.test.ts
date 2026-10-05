import { afterEach, describe, expect, it, vi } from "vitest";
import { _test, getStoreKitRail, StoreKitPendingError } from "./AppStoreBridge";

type Listener = (txs: unknown[]) => void;

function fakeMasBridge() {
  const listeners = new Set<Listener>();
  const bridge = {
    isMasBuild: true,
    isAvailable: vi.fn(async () => true),
    getProducts: vi.fn(async (ids: string[]) =>
      ids.map((productId) => ({ productId, title: "Night", formattedPrice: "1,99 €" })),
    ),
    purchase: vi.fn(async () => ({ ok: true as const })),
    restore: vi.fn(async () => {}),
    getPendingTransactions: vi.fn(async () => []),
    finishTransaction: vi.fn(async () => true),
    onTransactions: (cb: Listener) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  const fire = (txs: unknown[]) => {
    for (const l of [...listeners]) l(txs);
  };
  return { bridge, fire, listeners };
}

const PRODUCT = "com.ricoslabs.tiao.theme.night";
const TOKEN = "0f9a3c1e-2b4d-5e6f-8a9b-0c1d2e3f4a5b";

afterEach(() => {
  const w = window as unknown as Record<string, unknown>;
  delete w.Capacitor;
  delete w.electron;
});

describe("getStoreKitRail", () => {
  it("is null in a browser", () => {
    expect(getStoreKitRail()).toBeNull();
  });

  it("is ios inside the native iOS app, null on Android", () => {
    const w = window as unknown as Record<string, unknown>;
    w.Capacitor = { getPlatform: () => "ios", isNativePlatform: () => true };
    expect(getStoreKitRail()).toBe("ios");
    w.Capacitor = { getPlatform: () => "android", isNativePlatform: () => true };
    expect(getStoreKitRail()).toBeNull();
  });

  it("is mas only in a Mac App Store build", () => {
    const w = window as unknown as Record<string, unknown>;
    w.electron = { iap: { isMasBuild: false } };
    expect(getStoreKitRail()).toBeNull();
    w.electron = { iap: { isMasBuild: true } };
    expect(getStoreKitRail()).toBe("mas");
  });
});

describe("Mac App Store adapter", () => {
  it("resolves with the transaction id once StoreKit reports the purchase", async () => {
    const { bridge, fire, listeners } = fakeMasBridge();
    const adapter = _test.createMasAdapter(bridge as never);
    const pending = adapter.purchase(PRODUCT, TOKEN);
    await Promise.resolve();
    expect(bridge.purchase).toHaveBeenCalledWith(PRODUCT, TOKEN);
    fire([{ transactionId: "", productId: PRODUCT, state: "purchasing" }]);
    fire([{ transactionId: "2000000111", productId: PRODUCT, state: "purchased" }]);
    await expect(pending).resolves.toEqual({ transactionId: "2000000111" });
    expect(listeners.size).toBe(0);
  });

  it("treats SKErrorPaymentCancelled as a cancel, other failures as errors", async () => {
    const { bridge, fire } = fakeMasBridge();
    const adapter = _test.createMasAdapter(bridge as never);
    const cancelled = adapter.purchase(PRODUCT, TOKEN);
    fire([{ transactionId: "", productId: PRODUCT, state: "failed", errorCode: 2 }]);
    await expect(cancelled).resolves.toBeNull();

    const failed = adapter.purchase(PRODUCT, TOKEN);
    fire([
      { transactionId: "", productId: PRODUCT, state: "failed", errorCode: 0, errorMessage: "x" },
    ]);
    await expect(failed).rejects.toThrow("x");

    const deferred = adapter.purchase(PRODUCT, TOKEN);
    fire([{ transactionId: "", productId: PRODUCT, state: "deferred" }]);
    await expect(deferred).rejects.toBeInstanceOf(StoreKitPendingError);
  });

  it("maps localized App Store prices", async () => {
    const { bridge } = fakeMasBridge();
    const products = await _test.createMasAdapter(bridge as never).getProducts([PRODUCT]);
    expect(products).toEqual([{ productId: PRODUCT, title: "Night", priceString: "1,99 €" }]);
  });

  it("finishes the StoreKit transaction only when asked", async () => {
    const { bridge } = fakeMasBridge();
    await _test.createMasAdapter(bridge as never).finish({ transactionId: "2000000111" });
    expect(bridge.finishTransaction).toHaveBeenCalledWith("2000000111");
  });
});

describe("iOS adapter", () => {
  function plugin(overrides: Record<string, unknown> = {}) {
    return {
      getProducts: vi.fn(async () => ({
        products: [{ identifier: PRODUCT, title: "Night", priceString: "$1.99" }],
      })),
      purchaseProduct: vi.fn(async () => ({
        transactionId: "1",
        productIdentifier: PRODUCT,
        jwsRepresentation: "a.b.c",
      })),
      restorePurchases: vi.fn(async () => {}),
      getPurchases: vi.fn(async () => ({
        purchases: [
          { transactionId: "1", productIdentifier: PRODUCT, jwsRepresentation: "a.b.c" },
          { transactionId: "2", productIdentifier: PRODUCT },
        ],
      })),
      addListener: vi.fn(async () => ({ remove: async () => {} })),
      ...overrides,
    };
  }

  it("sends the signed StoreKit 2 transaction with the account token", async () => {
    const p = plugin();
    const proof = await _test.createIosAdapter(p).purchase(PRODUCT, TOKEN);
    expect(p.purchaseProduct).toHaveBeenCalledWith({
      productIdentifier: PRODUCT,
      quantity: 1,
      appAccountToken: TOKEN,
    });
    expect(proof).toEqual({ signedTransaction: "a.b.c" });
  });

  it("returns null when the player cancels the payment sheet", async () => {
    const p = plugin({
      purchaseProduct: vi.fn(async () => {
        throw new Error("Purchase was cancelled.");
      }),
    });
    await expect(_test.createIosAdapter(p).purchase(PRODUCT, TOKEN)).resolves.toBeNull();
  });

  it("restores current entitlements that carry a JWS", async () => {
    const p = plugin();
    const proofs = await _test.createIosAdapter(p).restore();
    expect(p.restorePurchases).toHaveBeenCalled();
    expect(p.getPurchases).toHaveBeenCalledWith({ onlyCurrentEntitlements: true });
    expect(proofs).toEqual([{ signedTransaction: "a.b.c" }]);
  });
});
