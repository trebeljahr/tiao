import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  getDistributionChannel,
  getNativeMobilePlatform,
  isAppStoreChannel,
  useIsAppStoreChannel,
} from "./distributionChannel";

type W = { electron?: unknown; Capacitor?: unknown };

function setElectron(config: Record<string, unknown>) {
  (window as unknown as W).electron = { isElectron: true, config };
}

function setCapacitor(platform: string, native = true) {
  (window as unknown as W).Capacitor = {
    isNativePlatform: () => native,
    getPlatform: () => platform,
  };
}

afterEach(() => {
  delete (window as unknown as W).electron;
  delete (window as unknown as W).Capacitor;
});

describe("getDistributionChannel", () => {
  it("is web in a plain browser", () => {
    expect(getDistributionChannel()).toBe("web");
  });

  it("reads the Capacitor native platform", () => {
    setCapacitor("ios");
    expect(getDistributionChannel()).toBe("ios");
    setCapacitor("android");
    expect(getDistributionChannel()).toBe("android");
  });

  it("ignores Capacitor's web shim", () => {
    setCapacitor("web", false);
    expect(getNativeMobilePlatform()).toBeNull();
    expect(getDistributionChannel()).toBe("web");
  });

  it("reads the Electron distribution channel", () => {
    for (const channel of ["direct", "itch", "steam", "mas", "msstore"]) {
      setElectron({ distributionChannel: channel });
      expect(getDistributionChannel()).toBe(channel);
    }
  });

  it("treats a Steam build as steam even without a channel field", () => {
    setElectron({ isSteamBuild: true });
    expect(getDistributionChannel()).toBe("steam");
  });

  it("falls back to direct for an unknown or missing desktop channel", () => {
    setElectron({});
    expect(getDistributionChannel()).toBe("direct");
    setElectron({ distributionChannel: "ios" });
    expect(getDistributionChannel()).toBe("direct");
  });
});

describe("isAppStoreChannel", () => {
  it.each([
    ["web", false],
    ["direct", false],
    ["itch", false],
    ["steam", true],
    ["mas", true],
    ["msstore", true],
    ["ios", true],
    ["android", true],
  ] as const)("%s → %s", (channel, expected) => {
    expect(isAppStoreChannel(channel)).toBe(expected);
  });

  it("defaults to the detected channel", () => {
    expect(isAppStoreChannel()).toBe(false);
    setCapacitor("android");
    expect(isAppStoreChannel()).toBe(true);
  });
});

describe("useIsAppStoreChannel", () => {
  it("reports the detected channel on the client", () => {
    setElectron({ distributionChannel: "mas" });
    const { result } = renderHook(() => useIsAppStoreChannel());
    expect(result.current).toBe(true);
  });
});
