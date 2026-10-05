import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ApiError: actual.ApiError,
    getStorePurchaseConfig: vi.fn(),
    prepareAppStorePurchase: vi.fn(async () => ({
      appAccountToken: "0f9a3c1e-2b4d-5e6f-8a9b-0c1d2e3f4a5b",
    })),
    verifyAppStorePurchase: vi.fn(),
    restoreAppStorePurchases: vi.fn(),
  };
});

import * as api from "./api";
import { canSeeShop } from "./featureGate";
import {
  _resetStorePurchaseConfigForTests,
  canSubscribeIn,
  getStorePurchaseChannel,
  purchaseWithAppStore,
  restoreFromAppStore,
  StorePurchaseCancelled,
} from "./storePurchases";

const TOKEN = "0f9a3c1e-2b4d-5e6f-8a9b-0c1d2e3f4a5b";
const NIGHT = { type: "theme", id: "night", appStoreProductId: "com.ricoslabs.tiao.theme.night" };
const ENABLED = { steam: { enabled: false, sandbox: false }, appStore: { enabled: true } };

function granted(itemId = "night") {
  return {
    purchase: {
      originalTransactionId: "1",
      productId: `com.ricoslabs.tiao.theme.${itemId}`,
      itemType: "theme" as const,
      itemId,
      status: "active" as const,
      entitled: true,
    },
  };
}

function installIos(plugin: Record<string, unknown> | null) {
  (window as unknown as { Capacitor: unknown }).Capacitor = {
    getPlatform: () => "ios",
    isNativePlatform: () => true,
    isPluginAvailable: (name: string) => plugin !== null && name === "NativePurchases",
    Plugins: plugin ? { NativePurchases: plugin } : {},
  };
}

function iosPlugin(overrides: Record<string, unknown> = {}) {
  return {
    getProducts: vi.fn(),
    purchaseProduct: vi.fn(async () => ({
      transactionId: "1",
      productIdentifier: NIGHT.appStoreProductId,
      jwsRepresentation: "h.p.s",
    })),
    restorePurchases: vi.fn(async () => {}),
    getPurchases: vi.fn(async () => ({
      purchases: [{ transactionId: "1", productIdentifier: "x", jwsRepresentation: "h.p.s" }],
    })),
    addListener: vi.fn(async () => ({ remove: async () => {} })),
    ...overrides,
  };
}

function installMas() {
  const listeners = new Set<(txs: unknown[]) => void>();
  const bridge = {
    isMasBuild: true,
    isAvailable: vi.fn(async () => true),
    getProducts: vi.fn(async () => []),
    purchase: vi.fn(async () => {
      queueMicrotask(() => {
        for (const l of [...listeners]) {
          l([
            { transactionId: "2000000111", productId: NIGHT.appStoreProductId, state: "purchased" },
          ]);
        }
      });
      return { ok: true };
    }),
    restore: vi.fn(async () => {}),
    getPendingTransactions: vi.fn(async () => []),
    finishTransaction: vi.fn(async () => true),
    onTransactions: (cb: (txs: unknown[]) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  (window as unknown as { electron: unknown }).electron = { iap: bridge };
  return bridge;
}

afterEach(() => {
  const w = window as unknown as Record<string, unknown>;
  delete w.Capacitor;
  delete w.electron;
  _resetStorePurchaseConfigForTests(null);
  vi.clearAllMocks();
});

describe("app_store channel", () => {
  it("stays hidden on iOS until the server enables App Store purchases", () => {
    installIos(iosPlugin());
    expect(getStorePurchaseChannel()).toBe("loading");
    _resetStorePurchaseConfigForTests({ steam: { enabled: false, sandbox: false } });
    expect(getStorePurchaseChannel()).toBe("none");
    expect(canSeeShop(null)).toBe(false);
    _resetStorePurchaseConfigForTests(ENABLED);
    expect(getStorePurchaseChannel()).toBe("app_store");
    expect(canSeeShop(null)).toBe(true);
    expect(canSubscribeIn("app_store")).toBe(true);
  });

  it("stays hidden in an iOS build without the StoreKit plugin", () => {
    installIos(null);
    _resetStorePurchaseConfigForTests(ENABLED);
    expect(getStorePurchaseChannel()).toBe("none");
  });

  it("opens in a Mac App Store build with the preload bridge", () => {
    installMas();
    _resetStorePurchaseConfigForTests(ENABLED);
    expect(getStorePurchaseChannel()).toBe("app_store");
  });
});

describe("purchaseWithAppStore", () => {
  it("iOS: passes the account token to StoreKit and verifies the signed transaction", async () => {
    const plugin = iosPlugin();
    installIos(plugin);
    vi.mocked(api.verifyAppStorePurchase).mockResolvedValue(granted());

    const result = await purchaseWithAppStore(NIGHT);

    expect(plugin.purchaseProduct).toHaveBeenCalledWith({
      productIdentifier: NIGHT.appStoreProductId,
      quantity: 1,
      appAccountToken: TOKEN,
    });
    expect(api.verifyAppStorePurchase).toHaveBeenCalledWith({ signedTransaction: "h.p.s" });
    expect(result).toEqual({ status: "granted", itemType: "theme", itemId: "night" });
  });

  it("throws StorePurchaseCancelled when the player dismisses the sheet", async () => {
    installIos(
      iosPlugin({
        purchaseProduct: vi.fn(async () => {
          throw new Error("User cancelled");
        }),
      }),
    );
    await expect(purchaseWithAppStore(NIGHT)).rejects.toBeInstanceOf(StorePurchaseCancelled);
    expect(api.verifyAppStorePurchase).not.toHaveBeenCalled();
  });

  it("reports a purchase owned by another Tiao account", async () => {
    installIos(iosPlugin());
    vi.mocked(api.verifyAppStorePurchase).mockRejectedValue(
      new api.ApiError(409, "taken", "PURCHASE_CLAIMED_BY_OTHER_ACCOUNT"),
    );
    await expect(purchaseWithAppStore(NIGHT)).resolves.toMatchObject({
      status: "failed",
      reason: "claimed_elsewhere",
    });
  });

  it("Mac App Store: sends the transaction id and finishes it only after the server grants", async () => {
    const bridge = installMas();
    let finishedBeforeVerify = false;
    vi.mocked(api.verifyAppStorePurchase).mockImplementation(async () => {
      finishedBeforeVerify = bridge.finishTransaction.mock.calls.length > 0;
      return granted();
    });

    const result = await purchaseWithAppStore(NIGHT);

    expect(bridge.purchase).toHaveBeenCalledWith(NIGHT.appStoreProductId, TOKEN);
    expect(api.verifyAppStorePurchase).toHaveBeenCalledWith({ transactionId: "2000000111" });
    expect(finishedBeforeVerify).toBe(false);
    expect(bridge.finishTransaction).toHaveBeenCalledWith("2000000111");
    expect(result.status).toBe("granted");
  });

  it("leaves the Mac transaction unfinished when the server refuses it", async () => {
    const bridge = installMas();
    vi.mocked(api.verifyAppStorePurchase).mockRejectedValue(new api.ApiError(400, "bad"));
    await expect(purchaseWithAppStore(NIGHT)).rejects.toThrow("bad");
    expect(bridge.finishTransaction).not.toHaveBeenCalled();
  });
});

describe("restoreFromAppStore", () => {
  it("syncs with the App Store and counts what the server granted", async () => {
    const plugin = iosPlugin();
    installIos(plugin);
    vi.mocked(api.restoreAppStorePurchases).mockResolvedValue({
      purchases: [granted().purchase, { ...granted("ocean").purchase, entitled: false }],
      errors: [],
    });
    await expect(restoreFromAppStore()).resolves.toEqual({ granted: 1 });
    expect(plugin.restorePurchases).toHaveBeenCalled();
    expect(api.restoreAppStorePurchases).toHaveBeenCalledWith([{ signedTransaction: "h.p.s" }]);
  });
});
