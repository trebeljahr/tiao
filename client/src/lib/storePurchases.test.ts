import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  getStorePurchaseConfig: vi.fn(),
  startSteamPurchase: vi.fn(),
  finalizeSteamPurchase: vi.fn(),
}));

import * as api from "./api";
import { _resetSteamActiveCacheForTests } from "./SteamBridge";
import {
  _resetStorePurchaseConfigForTests,
  getStorePurchaseChannel,
  loadStorePurchaseConfig,
  purchaseWithSteam,
  StorePurchaseCancelled,
  StoreUnavailableError,
} from "./storePurchases";

type Listener = (e: { appId: number; orderId: string; authorized: boolean }) => void;

function installSteam({ ticket = "abcdef0123456789" as string | null } = {}) {
  const listeners = new Set<Listener>();
  (window as unknown as { electron: unknown }).electron = {
    config: { isSteamBuild: true },
    steam: {
      isActive: async () => true,
      getWebApiTicket: async () => ticket,
      onMicroTxnAuthorization: (cb: Listener) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    },
  };
  return {
    fire(orderId: string, authorized: boolean) {
      for (const l of [...listeners]) l({ appId: 5035580, orderId, authorized });
    },
    listenerCount: () => listeners.size,
  };
}

describe("store purchase channel", () => {
  afterEach(() => {
    delete (window as unknown as { electron?: unknown }).electron;
    _resetStorePurchaseConfigForTests(null);
    _resetSteamActiveCacheForTests();
    vi.clearAllMocks();
  });

  it("is stripe on the web", () => {
    expect(getStorePurchaseChannel()).toBe("stripe");
  });

  it("is loading in a Steam build until config arrives, then steam", async () => {
    installSteam();
    expect(getStorePurchaseChannel()).toBe("loading");
    vi.mocked(api.getStorePurchaseConfig).mockResolvedValue({
      steam: { enabled: true, sandbox: false },
    });
    await loadStorePurchaseConfig();
    expect(getStorePurchaseChannel()).toBe("steam");
  });

  it("is none in a Steam build when the config request fails", async () => {
    installSteam();
    vi.mocked(api.getStorePurchaseConfig).mockRejectedValue(new Error("offline"));
    await loadStorePurchaseConfig();
    expect(getStorePurchaseChannel()).toBe("none");
  });
});

describe("purchaseWithSteam", () => {
  beforeEach(() => {
    _resetSteamActiveCacheForTests();
  });
  afterEach(() => {
    delete (window as unknown as { electron?: unknown }).electron;
    vi.clearAllMocks();
  });

  it("sends the ticket, waits for approval of its own order, then finalizes", async () => {
    const steam = installSteam();
    vi.mocked(api.startSteamPurchase).mockResolvedValue({ orderId: "777" });
    vi.mocked(api.finalizeSteamPurchase).mockResolvedValue({
      status: "granted",
      itemType: "badge",
      itemId: "supporter",
    });

    const pending = purchaseWithSteam({ type: "badge", id: "supporter" }, "de");
    await vi.waitFor(() => expect(steam.listenerCount()).toBe(1));
    steam.fire("123", true); // someone else's order — ignored
    expect(api.finalizeSteamPurchase).not.toHaveBeenCalled();
    steam.fire("777", true);

    await expect(pending).resolves.toMatchObject({ status: "granted" });
    expect(api.startSteamPurchase).toHaveBeenCalledWith({
      itemType: "badge",
      itemId: "supporter",
      ticket: "abcdef0123456789",
      language: "de",
    });
    expect(api.finalizeSteamPurchase).toHaveBeenCalledWith("777");
    expect(steam.listenerCount()).toBe(0);
  });

  it("throws StorePurchaseCancelled when the player cancels in the overlay", async () => {
    const steam = installSteam();
    vi.mocked(api.startSteamPurchase).mockResolvedValue({ orderId: "9" });
    vi.mocked(api.finalizeSteamPurchase).mockResolvedValue({
      status: "failed",
      itemType: "theme",
      itemId: "night",
    });
    const pending = purchaseWithSteam({ type: "theme", id: "night" }, "en");
    await vi.waitFor(() => expect(steam.listenerCount()).toBe(1));
    steam.fire("9", false);
    await expect(pending).rejects.toBeInstanceOf(StorePurchaseCancelled);
  });

  it("refuses to start without a Steam ticket", async () => {
    installSteam({ ticket: null });
    await expect(purchaseWithSteam({ type: "theme", id: "night" }, "en")).rejects.toBeInstanceOf(
      StoreUnavailableError,
    );
    expect(api.startSteamPurchase).not.toHaveBeenCalled();
  });
});
