import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSteamAchievementSync } from "./useSteamAchievementSync";

// Spy on the bridge wrapper rather than the IPC layer — the wrapper
// already has its own test coverage, so this suite focuses on the
// hook's dedupe and lifecycle behavior.
const unlockSpy = vi.fn();
vi.mock("./SteamBridge", () => ({
  unlockSteamAchievement: (apiName: string) => unlockSpy(apiName),
}));

beforeEach(() => {
  unlockSpy.mockClear();
  unlockSpy.mockResolvedValue(true);
});

afterEach(() => {
  unlockSpy.mockReset();
});

describe("useSteamAchievementSync", () => {
  it("does nothing when the unlocked list is empty", () => {
    renderHook(() => useSteamAchievementSync([]));
    expect(unlockSpy).not.toHaveBeenCalled();
  });

  it("pushes every supplied unlocked id once", async () => {
    renderHook(() => useSteamAchievementSync(["first-move", "speed-demon"]));
    // The effect is async — flush microtasks before asserting.
    await new Promise((r) => setTimeout(r, 0));
    expect(unlockSpy).toHaveBeenCalledTimes(2);
    expect(unlockSpy).toHaveBeenCalledWith("first-move");
    expect(unlockSpy).toHaveBeenCalledWith("speed-demon");
  });

  it("does not re-push ids that have already been handed to the bridge", async () => {
    const { rerender } = renderHook(({ ids }) => useSteamAchievementSync(ids), {
      initialProps: { ids: ["first-move"] },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(unlockSpy).toHaveBeenCalledTimes(1);

    // Rerender with a superset — only the new id should hit the bridge.
    rerender({ ids: ["first-move", "speed-demon"] });
    await new Promise((r) => setTimeout(r, 0));
    expect(unlockSpy).toHaveBeenCalledTimes(2);
    expect(unlockSpy).toHaveBeenLastCalledWith("speed-demon");
  });

  it("falls back to the id when no steamKey override is defined", async () => {
    renderHook(() => useSteamAchievementSync(["first-move"]));
    await new Promise((r) => setTimeout(r, 0));
    expect(unlockSpy).toHaveBeenCalledWith("first-move");
  });
});
