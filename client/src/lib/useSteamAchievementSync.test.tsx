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

  it("pushes every supplied unlocked id once, translated to its Steam API name", async () => {
    renderHook(() => useSteamAchievementSync(["first-move", "speed-demon"]));
    // The effect is async — flush microtasks before asserting.
    await new Promise((r) => setTimeout(r, 0));
    expect(unlockSpy).toHaveBeenCalledTimes(2);
    expect(unlockSpy).toHaveBeenCalledWith("ACH_FIRST_MOVE");
    expect(unlockSpy).toHaveBeenCalledWith("ACH_SPEED_DEMON");
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
    expect(unlockSpy).toHaveBeenLastCalledWith("ACH_SPEED_DEMON");
  });

  it("skips ids with no local definition instead of sending the raw id", async () => {
    // A server running ahead of this bundle can report an achievement
    // that isn't in ACHIEVEMENTS yet. Its kebab-case id is never a valid
    // Steam API name, so passing it through would be a silent no-op on
    // Steam's side — and silent no-ops are how mismapped achievements go
    // unnoticed until a player complains.
    renderHook(() => useSteamAchievementSync(["not-a-real-achievement", "first-move"]));
    await new Promise((r) => setTimeout(r, 0));
    expect(unlockSpy).toHaveBeenCalledTimes(1);
    expect(unlockSpy).toHaveBeenCalledWith("ACH_FIRST_MOVE");
  });
});
