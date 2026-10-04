import type { AuthResponse } from "@shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canSeeShop, hasPreviewAccess, isAdmin, resolvePlayerBadges } from "./featureGate";
import { _resetStorePurchaseConfigForTests } from "./storePurchases";

function makeAuth(overrides: Partial<AuthResponse["player"]> = {}): AuthResponse {
  return {
    player: {
      playerId: "test-id",
      displayName: "testuser",
      kind: "account",
      badges: [],
      activeBadges: [],
      ...overrides,
    },
  };
}

describe("hasPreviewAccess", () => {
  it("returns false for null auth", () => {
    expect(hasPreviewAccess(null)).toBe(false);
  });

  it("returns false for guest player", () => {
    const auth = makeAuth({ kind: "guest" });
    expect(hasPreviewAccess(auth)).toBe(false);
  });

  it("returns false for account with no unlocked themes", () => {
    const auth = makeAuth({ unlockedThemes: [] });
    expect(hasPreviewAccess(auth)).toBe(false);
  });

  it("returns false for account with badges but no unlocked themes", () => {
    const auth = makeAuth({ badges: ["creator"] });
    expect(hasPreviewAccess(auth)).toBe(false);
  });

  it("returns true for account with unlocked themes", () => {
    const auth = makeAuth({ unlockedThemes: ["night"] });
    expect(hasPreviewAccess(auth)).toBe(true);
  });
});

describe("isAdmin", () => {
  it("returns false for null auth", () => {
    expect(isAdmin(null)).toBe(false);
  });

  it("returns false for guest player", () => {
    const auth = makeAuth({ kind: "guest" });
    expect(isAdmin(auth)).toBe(false);
  });

  it("returns false for account without isAdmin flag", () => {
    const auth = makeAuth();
    expect(isAdmin(auth)).toBe(false);
  });

  it("returns true for account with isAdmin flag", () => {
    const auth = makeAuth({ isAdmin: true });
    expect(isAdmin(auth)).toBe(true);
  });
});

describe("resolvePlayerBadges", () => {
  it("returns empty array for null player", () => {
    expect(resolvePlayerBadges(null)).toEqual([]);
  });

  it("returns empty array for undefined player", () => {
    expect(resolvePlayerBadges(undefined)).toEqual([]);
  });

  it("returns empty array when activeBadges is empty (user chose hidden)", () => {
    expect(resolvePlayerBadges({ activeBadges: [] })).toEqual([]);
  });

  it("returns valid active badges from server data", () => {
    expect(resolvePlayerBadges({ activeBadges: ["creator", "supporter"] })).toEqual([
      "creator",
      "supporter",
    ]);
  });

  it("filters out unknown badge IDs", () => {
    expect(resolvePlayerBadges({ activeBadges: ["creator", "nonexistent-badge"] })).toEqual([
      "creator",
    ]);
  });

  it("returns empty array when no activeBadges property exists", () => {
    expect(resolvePlayerBadges({})).toEqual([]);
  });
});

describe("canSeeShop", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    // Delete rather than set undefined: the non-desktop case is an
    // absent `electron` global, and `isSteamBuild()` reads through it
    // with optional chaining either way — but leaving a stub behind
    // would quietly make every later test a desktop test.
    delete (window as unknown as { electron?: unknown }).electron;
    _resetStorePurchaseConfigForTests(null);
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  });

  function setDesktopChannel(distributionChannel: string) {
    (window as unknown as { electron?: unknown }).electron = {
      config: { isSteamBuild: false, distributionChannel },
    };
  }

  function setNativeMobile(platform: "ios" | "android") {
    (window as unknown as { Capacitor?: unknown }).Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => platform,
    };
  }

  it.each(["mas", "msstore"])("is hidden in the %s desktop store build", (channel) => {
    setDesktopChannel(channel);
    expect(canSeeShop(makeAuth({ isAdmin: true }))).toBe(false);
  });

  it.each(["direct", "itch"])("stays visible in the %s desktop build", (channel) => {
    setDesktopChannel(channel);
    expect(canSeeShop(makeAuth())).toBe(true);
  });

  it.each(["ios", "android"] as const)("is hidden in the native %s app", (platform) => {
    setNativeMobile(platform);
    expect(canSeeShop(makeAuth({ isAdmin: true }))).toBe(false);
  });

  function setSteamBuild(isSteamBuild: boolean, withPurchaseBridge = false) {
    (window as unknown as { electron?: unknown }).electron = {
      config: { isSteamBuild },
      steam: withPurchaseBridge
        ? { getWebApiTicket: async () => null, onMicroTxnAuthorization: () => () => {} }
        : {},
    };
  }

  it("is public in production for visitors, guests, and regular accounts", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(canSeeShop(null)).toBe(true);
    expect(canSeeShop(makeAuth({ kind: "guest" }))).toBe(true);
    expect(canSeeShop(makeAuth())).toBe(true);
  });

  it("is visible to an admin outside a Steam build", () => {
    expect(canSeeShop(makeAuth({ isAdmin: true }))).toBe(true);
  });

  it("is hidden in a Steam build even for an admin", () => {
    // Valve requires in-game purchases to use Steam's payment system.
    // The admin escape hatch exists to playtest Stripe — doing that
    // inside the Steam client is the violation, not an exception to it.
    setSteamBuild(true);
    expect(canSeeShop(makeAuth({ isAdmin: true }))).toBe(false);
  });

  it("is hidden in a Steam build for a signed-out visitor", () => {
    setSteamBuild(true);
    expect(canSeeShop(null)).toBe(false);
  });

  it("appears in a Steam build once Steam Microtransactions are configured", () => {
    setSteamBuild(true, true);
    expect(canSeeShop(null)).toBe(false);
    _resetStorePurchaseConfigForTests({ steam: { enabled: true, sandbox: false } });
    expect(canSeeShop(null)).toBe(true);
  });

  it("stays hidden in a Steam build when the server cannot sell on Steam", () => {
    setSteamBuild(true, true);
    _resetStorePurchaseConfigForTests({ steam: { enabled: false, sandbox: false } });
    expect(canSeeShop(null)).toBe(false);
  });

  it("stays hidden on an older Steam desktop without the purchase bridge", () => {
    setSteamBuild(true, false);
    _resetStorePurchaseConfigForTests({ steam: { enabled: true, sandbox: false } });
    expect(canSeeShop(null)).toBe(false);
  });

  it("is unaffected by a desktop build that is not a Steam build", () => {
    setSteamBuild(false);
    expect(canSeeShop(makeAuth({ isAdmin: true }))).toBe(true);
  });
});
