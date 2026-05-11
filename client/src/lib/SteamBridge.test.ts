import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetSteamActiveCacheForTests,
  getSteamAchievementStates,
  isSteamActive,
  openSteamOverlay,
  openSteamOverlayUrl,
  unlockSteamAchievement,
} from "./SteamBridge";

// ─── Bridge stubs ─────────────────────────────────────────────
//
// `window.electron.steam` is the contextBridge surface exposed by
// desktop/preload.cjs. Web builds, mobile builds, and non-Steam
// desktop builds all see `undefined` and the bridge wrappers must
// fall back to safe defaults without throwing.
//
// The mock shape mirrors the typedef in SteamBridge.ts but is kept
// local to avoid exporting that type for test-only use.
type MockSteamApi = {
  isActive?: () => Promise<boolean>;
  getUser?: () => Promise<unknown>;
  unlockAchievement?: (apiName: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
  indicateAchievementProgress?: (
    apiName: string,
    current: number,
    max: number,
  ) => Promise<{ ok: true } | { ok: false; reason: string }>;
  getAchievementStates?: (apiNames: string[]) => Promise<Record<string, boolean>>;
  openOverlay?: (dialog: string) => Promise<boolean>;
  openOverlayUrl?: (url: string) => Promise<boolean>;
};

function installBridge(api: MockSteamApi): void {
  (window as unknown as { electron?: { steam?: MockSteamApi } }).electron = {
    steam: api,
  };
}

function clearBridge(): void {
  delete (window as unknown as { electron?: unknown }).electron;
}

beforeEach(() => {
  clearBridge();
  _resetSteamActiveCacheForTests();
});

afterEach(() => {
  clearBridge();
  _resetSteamActiveCacheForTests();
});

describe("isSteamActive", () => {
  it("returns false when window.electron is undefined", async () => {
    await expect(isSteamActive()).resolves.toBe(false);
  });

  it("returns false when the bridge resolves false", async () => {
    installBridge({ isActive: vi.fn().mockResolvedValue(false) });
    await expect(isSteamActive()).resolves.toBe(false);
  });

  it("returns true when the bridge resolves true", async () => {
    installBridge({ isActive: vi.fn().mockResolvedValue(true) });
    await expect(isSteamActive()).resolves.toBe(true);
  });

  it("memoizes the result across calls", async () => {
    const spy = vi.fn().mockResolvedValue(true);
    installBridge({ isActive: spy });
    await isSteamActive();
    await isSteamActive();
    await isSteamActive();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("treats an IPC throw as inactive", async () => {
    installBridge({ isActive: vi.fn().mockRejectedValue(new Error("boom")) });
    await expect(isSteamActive()).resolves.toBe(false);
  });
});

describe("unlockSteamAchievement", () => {
  it("no-ops to false without the bridge", async () => {
    await expect(unlockSteamAchievement("ACH_TEST")).resolves.toBe(false);
  });

  it("no-ops to false when inactive", async () => {
    const unlock = vi.fn();
    installBridge({ isActive: vi.fn().mockResolvedValue(false), unlockAchievement: unlock });
    await expect(unlockSteamAchievement("ACH_TEST")).resolves.toBe(false);
    expect(unlock).not.toHaveBeenCalled();
  });

  it("forwards the api name and returns true on ok", async () => {
    const unlock = vi.fn().mockResolvedValue({ ok: true });
    installBridge({ isActive: vi.fn().mockResolvedValue(true), unlockAchievement: unlock });
    await expect(unlockSteamAchievement("ACH_FIRST_WIN")).resolves.toBe(true);
    expect(unlock).toHaveBeenCalledWith("ACH_FIRST_WIN");
  });

  it("returns false on an IPC throw without leaking the error", async () => {
    installBridge({
      isActive: vi.fn().mockResolvedValue(true),
      unlockAchievement: vi.fn().mockRejectedValue(new Error("boom")),
    });
    await expect(unlockSteamAchievement("ACH_TEST")).resolves.toBe(false);
  });
});

describe("getSteamAchievementStates", () => {
  it("returns {} without the bridge", async () => {
    await expect(getSteamAchievementStates(["a", "b"])).resolves.toEqual({});
  });

  it("returns {} when inactive", async () => {
    installBridge({ isActive: vi.fn().mockResolvedValue(false) });
    await expect(getSteamAchievementStates(["a"])).resolves.toEqual({});
  });

  it("forwards the names and returns the bridge response", async () => {
    installBridge({
      isActive: vi.fn().mockResolvedValue(true),
      getAchievementStates: vi.fn().mockResolvedValue({ a: true, b: false }),
    });
    await expect(getSteamAchievementStates(["a", "b"])).resolves.toEqual({
      a: true,
      b: false,
    });
  });
});

describe("openSteamOverlay", () => {
  it("returns false without the bridge", async () => {
    await expect(openSteamOverlay("Achievements")).resolves.toBe(false);
  });

  it("forwards the dialog name and bridge result", async () => {
    const open = vi.fn().mockResolvedValue(true);
    installBridge({ isActive: vi.fn().mockResolvedValue(true), openOverlay: open });
    await expect(openSteamOverlay("Achievements")).resolves.toBe(true);
    expect(open).toHaveBeenCalledWith("Achievements");
  });
});

describe("openSteamOverlayUrl", () => {
  it("returns false without the bridge", async () => {
    await expect(openSteamOverlayUrl("https://example.com")).resolves.toBe(false);
  });

  it("forwards the URL when active", async () => {
    const open = vi.fn().mockResolvedValue(true);
    installBridge({ isActive: vi.fn().mockResolvedValue(true), openOverlayUrl: open });
    await expect(openSteamOverlayUrl("https://store.steampowered.com")).resolves.toBe(true);
    expect(open).toHaveBeenCalledWith("https://store.steampowered.com");
  });
});
