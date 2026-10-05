import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  getStorePurchaseConfig: vi.fn(),
  getGooglePlayConfig: vi.fn(),
  verifyGooglePlayPurchase: vi.fn(),
  restoreGooglePlayPurchases: vi.fn(),
  startSteamPurchase: vi.fn(),
  finalizeSteamPurchase: vi.fn(),
}));

import * as api from "./api";
import { getGooglePlayPrices } from "./GooglePlayBridge";
import {
  _resetStorePurchaseConfigForTests,
  canSubscribeIn,
  getStorePurchaseChannel,
  loadStorePurchaseConfig,
  purchaseWithGooglePlay,
  restoreFromGooglePlay,
  StorePurchaseCancelled,
  StoreUnavailableError,
} from "./storePurchases";

type Plugin = {
  isBillingSupported: ReturnType<typeof vi.fn>;
  getProducts: ReturnType<typeof vi.fn>;
  purchaseProduct: ReturnType<typeof vi.fn>;
  getPurchases: ReturnType<typeof vi.fn>;
  manageSubscriptions: ReturnType<typeof vi.fn>;
  restorePurchases: ReturnType<typeof vi.fn>;
};

function installAndroid({ withPlugin = true } = {}): Plugin {
  const plugin: Plugin = {
    isBillingSupported: vi.fn(async () => ({ isBillingSupported: true })),
    getProducts: vi.fn(async () => ({ products: [] })),
    purchaseProduct: vi.fn(),
    getPurchases: vi.fn(async () => ({ purchases: [] })),
    manageSubscriptions: vi.fn(),
    restorePurchases: vi.fn(),
  };
  (window as unknown as { Capacitor: unknown }).Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => "android",
    isPluginAvailable: (name: string) => withPlugin && name === "NativePurchases",
    Plugins: withPlugin ? { NativePurchases: plugin } : {},
  };
  return plugin;
}

const PLAY_CONFIG: api.GooglePlayConfig = {
  enabled: true,
  packageName: "com.ricoslabs.tiao",
  obfuscatedAccountId: "a".repeat(64),
  products: [
    {
      productId: "badge_coral",
      basePlanId: null,
      productType: "inapp",
      itemType: "badge",
      itemId: "badge-1",
    },
    {
      productId: "sub_patron",
      basePlanId: "monthly",
      productType: "subs",
      itemType: "badge",
      itemId: "patron",
    },
  ],
};

afterEach(() => {
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  _resetStorePurchaseConfigForTests(null);
  vi.clearAllMocks();
});

describe("android purchase channel", () => {
  it("never falls back to Stripe in the Android app", async () => {
    installAndroid();
    expect(getStorePurchaseChannel()).toBe("loading");

    vi.mocked(api.getStorePurchaseConfig).mockResolvedValue({
      steam: { enabled: false, sandbox: false },
      googlePlay: { enabled: false },
    });
    await loadStorePurchaseConfig();
    expect(getStorePurchaseChannel()).toBe("none");
  });

  it("opens the shop once the server enables the Play storefront", async () => {
    installAndroid();
    vi.mocked(api.getStorePurchaseConfig).mockResolvedValue({
      steam: { enabled: false, sandbox: false },
      googlePlay: { enabled: true },
    });
    await loadStorePurchaseConfig();
    expect(getStorePurchaseChannel()).toBe("google_play");
    expect(canSubscribeIn("google_play")).toBe(true);
  });

  it("stays hidden in an app built without the billing plugin", () => {
    installAndroid({ withPlugin: false });
    _resetStorePurchaseConfigForTests({
      steam: { enabled: false, sandbox: false },
      googlePlay: { enabled: true },
    });
    expect(getStorePurchaseChannel()).toBe("none");
  });

  it("treats a server without the googlePlay field as not enabled", () => {
    installAndroid();
    _resetStorePurchaseConfigForTests({ steam: { enabled: true, sandbox: false } });
    expect(getStorePurchaseChannel()).toBe("none");
  });
});

describe("purchaseWithGooglePlay", () => {
  it("buys without client-side acknowledgement and lets the server verify", async () => {
    const plugin = installAndroid();
    vi.mocked(api.getGooglePlayConfig).mockResolvedValue(PLAY_CONFIG);
    plugin.purchaseProduct.mockResolvedValue({
      productIdentifier: "sub_patron",
      purchaseToken: "tok-1",
      purchaseState: "1",
    });
    vi.mocked(api.verifyGooglePlayPurchase).mockResolvedValue({
      status: "granted",
      itemType: "badge",
      itemId: "patron",
      kind: "subscription",
      acknowledged: true,
    });

    const result = await purchaseWithGooglePlay({ type: "badge", id: "patron" });

    expect(result).toEqual({ status: "granted", itemType: "badge", itemId: "patron" });
    expect(plugin.purchaseProduct).toHaveBeenCalledWith({
      productIdentifier: "sub_patron",
      productType: "subs",
      planIdentifier: "monthly",
      quantity: 1,
      appAccountToken: "a".repeat(64),
      isConsumable: false,
      autoAcknowledgePurchases: false,
    });
    expect(api.verifyGooglePlayPurchase).toHaveBeenCalledWith({
      productId: "sub_patron",
      purchaseToken: "tok-1",
    });
  });

  it("maps a cancelled Play sheet to StorePurchaseCancelled", async () => {
    const plugin = installAndroid();
    vi.mocked(api.getGooglePlayConfig).mockResolvedValue(PLAY_CONFIG);
    plugin.purchaseProduct.mockRejectedValue(
      Object.assign(new Error("Purchase is not purchased"), { code: "USER_CANCELED" }),
    );
    await expect(purchaseWithGooglePlay({ type: "badge", id: "badge-1" })).rejects.toBeInstanceOf(
      StorePurchaseCancelled,
    );
    expect(api.verifyGooglePlayPurchase).not.toHaveBeenCalled();
  });

  it("reports a pending payment without verifying", async () => {
    const plugin = installAndroid();
    vi.mocked(api.getGooglePlayConfig).mockResolvedValue(PLAY_CONFIG);
    plugin.purchaseProduct.mockRejectedValue(new Error("Purchase is pending"));
    expect(await purchaseWithGooglePlay({ type: "badge", id: "badge-1" })).toEqual({
      status: "pending",
      itemType: "badge",
      itemId: "badge-1",
    });
  });

  it("restores instead of failing when Play says the item is already owned", async () => {
    const plugin = installAndroid();
    vi.mocked(api.getGooglePlayConfig).mockResolvedValue(PLAY_CONFIG);
    plugin.purchaseProduct.mockRejectedValue(
      Object.assign(new Error("owned"), { code: "ITEM_ALREADY_OWNED" }),
    );
    plugin.getPurchases.mockImplementation(async ({ productType }: { productType: string }) => ({
      purchases:
        productType === "inapp" ? [{ productIdentifier: "badge_coral", purchaseToken: "old" }] : [],
    }));
    vi.mocked(api.restoreGooglePlayPurchases).mockResolvedValue({
      results: [
        {
          productId: "badge_coral",
          status: "granted",
          itemType: "badge",
          itemId: "badge-1",
          kind: "one_time",
          acknowledged: true,
        },
      ],
    });

    const result = await purchaseWithGooglePlay({ type: "badge", id: "badge-1" });
    expect(result.status).toBe("granted");
    expect(api.restoreGooglePlayPurchases).toHaveBeenCalledWith([
      { productId: "badge_coral", purchaseToken: "old" },
    ]);
    // The plugin's own restore acknowledges on the device — never used.
    expect(plugin.restorePurchases).not.toHaveBeenCalled();
  });

  it("refuses when the server has not enabled Play billing", async () => {
    installAndroid();
    vi.mocked(api.getGooglePlayConfig).mockResolvedValue({ ...PLAY_CONFIG, enabled: false });
    await expect(purchaseWithGooglePlay({ type: "badge", id: "badge-1" })).rejects.toBeInstanceOf(
      StoreUnavailableError,
    );
  });

  it("retries verification after a network failure", async () => {
    vi.useFakeTimers();
    try {
      const plugin = installAndroid();
      vi.mocked(api.getGooglePlayConfig).mockResolvedValue(PLAY_CONFIG);
      plugin.purchaseProduct.mockResolvedValue({
        productIdentifier: "badge_coral",
        purchaseToken: "tok-2",
      });
      vi.mocked(api.verifyGooglePlayPurchase)
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValueOnce({
          status: "granted",
          itemType: "badge",
          itemId: "badge-1",
          kind: "one_time",
          acknowledged: true,
        });
      const pending = purchaseWithGooglePlay({ type: "badge", id: "badge-1" });
      await vi.runAllTimersAsync();
      expect((await pending).status).toBe("granted");
      expect(api.verifyGooglePlayPurchase).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("restoreFromGooglePlay", () => {
  it("does not call the server when Play lists nothing", async () => {
    installAndroid();
    expect(await restoreFromGooglePlay()).toEqual({ granted: 0 });
    expect(api.restoreGooglePlayPurchases).not.toHaveBeenCalled();
  });
});

describe("getGooglePlayPrices", () => {
  it("returns Play's localized prices keyed by product id", async () => {
    const plugin = installAndroid();
    plugin.getProducts.mockImplementation(async ({ productType }: { productType: string }) => ({
      products:
        productType === "inapp"
          ? [{ identifier: "badge_coral", priceString: "2,99 €" }]
          : [{ identifier: "monthly", planIdentifier: "sub_patron", priceString: "4,99 €" }],
    }));
    expect(
      await getGooglePlayPrices([
        { productId: "badge_coral", productType: "inapp" },
        { productId: "sub_patron", productType: "subs" },
      ]),
    ).toEqual({ badge_coral: "2,99 €", sub_patron: "4,99 €" });
  });

  it("is empty outside the Android app", async () => {
    expect(await getGooglePlayPrices([{ productId: "badge_coral", productType: "inapp" }])).toEqual(
      {},
    );
  });
});
