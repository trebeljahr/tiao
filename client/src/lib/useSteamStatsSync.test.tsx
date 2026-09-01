import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSteamStatsSync } from "./useSteamStatsSync";

const setStatsSpy = vi.fn();
const progressSpy = vi.fn();

vi.mock("./SteamBridge", () => ({
  setSteamStats: (stats: Record<string, number>) => setStatsSpy(stats),
}));
vi.mock("./api", () => ({
  getAchievementProgress: () => progressSpy(),
}));

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  setStatsSpy.mockClear().mockResolvedValue(true);
  progressSpy.mockClear().mockResolvedValue({ gamesPlayed: 37, gamesLost: 4, friendCount: 2 });
});

afterEach(() => {
  setStatsSpy.mockReset();
  progressSpy.mockReset();
});

describe("useSteamStatsSync", () => {
  it("does nothing when disabled", async () => {
    renderHook(() => useSteamStatsSync(false));
    await flush();
    expect(progressSpy).not.toHaveBeenCalled();
    expect(setStatsSpy).not.toHaveBeenCalled();
  });

  it("maps the server's counts onto their Steam stat API names", async () => {
    renderHook(() => useSteamStatsSync(true));
    await flush();
    expect(setStatsSpy).toHaveBeenCalledWith({
      STAT_GAMES_PLAYED: 37,
      STAT_GAMES_LOST: 4,
      STAT_FRIENDS: 2,
    });
  });

  it("pushes once per mount even across re-renders", async () => {
    // The endpoint rescans every finished game and Steam rate-limits the
    // store() behind setStats, so a re-render must not spend another round.
    const { rerender } = renderHook(() => useSteamStatsSync(true));
    await flush();
    rerender();
    await flush();
    expect(progressSpy).toHaveBeenCalledTimes(1);
    expect(setStatsSpy).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when the progress fetch fails", async () => {
    // Progress bars are cosmetic; the unlock itself already synced.
    progressSpy.mockRejectedValue(new Error("500"));
    renderHook(() => useSteamStatsSync(true));
    await flush();
    expect(setStatsSpy).not.toHaveBeenCalled();
  });

  it("skips non-numeric values rather than sending them to Steam", async () => {
    progressSpy.mockResolvedValue({ gamesPlayed: 5, gamesLost: undefined, friendCount: 1 });
    renderHook(() => useSteamStatsSync(true));
    await flush();
    expect(setStatsSpy).toHaveBeenCalledWith({ STAT_GAMES_PLAYED: 5, STAT_FRIENDS: 1 });
  });
});
