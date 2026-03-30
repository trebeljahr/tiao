import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useGamesIndex } from "./useGamesIndex";
import type { AuthResponse } from "@shared";

const mockAuth: AuthResponse = {
  player: {
    kind: "account",
    playerId: "player-1",
    displayName: "Test User",
  } as AuthResponse["player"],
};

const mockListMultiplayerGames = vi.fn();

vi.mock("../api", () => ({
  listMultiplayerGames: (...args: unknown[]) => mockListMultiplayerGames(...args),
}));

vi.mock("../errors", () => ({
  toastError: vi.fn(),
}));

// Mock fetchWithRetry to skip delays in tests but still retry
vi.mock("../fetchWithRetry", () => ({
  fetchWithRetry: async (fn: () => Promise<unknown>) => {
    for (let i = 0; i <= 3; i++) {
      try {
        return await fn();
      } catch (error) {
        if (i === 3) throw error;
      }
    }
  },
}));

beforeEach(() => {
  mockListMultiplayerGames.mockReset();
});

describe("useGamesIndex", () => {
  it("initialises with empty active and finished arrays", () => {
    mockListMultiplayerGames.mockResolvedValue({ games: { active: [], finished: [] } });
    const { result } = renderHook(() => useGamesIndex(null));

    expect(result.current.multiplayerGames).toEqual({
      active: [],
      finished: [],
    });
  });

  it("does not fetch when auth is null", async () => {
    mockListMultiplayerGames.mockResolvedValue({ games: { active: [], finished: [] } });
    renderHook(() => useGamesIndex(null));

    // Wait a tick to ensure no async call was made
    await new Promise((r) => setTimeout(r, 50));
    expect(mockListMultiplayerGames).not.toHaveBeenCalled();
  });

  it("fetches games when auth is an account", async () => {
    const games = {
      active: [{ gameId: "ABC123", status: "waiting" }],
      finished: [],
    };
    mockListMultiplayerGames.mockResolvedValue({ games });

    const { result } = renderHook(() => useGamesIndex(mockAuth));

    await waitFor(() => {
      expect(result.current.multiplayerGamesLoaded).toBe(true);
    });

    expect(result.current.multiplayerGames.active).toHaveLength(1);
    expect(result.current.multiplayerGames.active[0].gameId).toBe("ABC123");
  });

  it("handles API returning games without active field (the bug fix)", async () => {
    // Simulate malformed API response where games has no `active` key
    mockListMultiplayerGames.mockResolvedValue({
      games: { finished: [] } as any,
    });

    const { result } = renderHook(() => useGamesIndex(mockAuth));

    await waitFor(() => {
      expect(result.current.multiplayerGamesLoaded).toBe(true);
    });

    // Should gracefully default to empty arrays instead of crashing
    expect(result.current.multiplayerGames.active).toEqual([]);
    expect(result.current.multiplayerGames.finished).toEqual([]);
  });

  it("handles API returning undefined games object", async () => {
    // Simulate response.games being undefined
    mockListMultiplayerGames.mockResolvedValue({ games: undefined });

    const { result } = renderHook(() => useGamesIndex(mockAuth));

    await waitFor(() => {
      expect(result.current.multiplayerGamesLoaded).toBe(true);
    });

    expect(result.current.multiplayerGames.active).toEqual([]);
    expect(result.current.multiplayerGames.finished).toEqual([]);
  });

  it("clears stale games and re-fetches when player identity changes (logout)", async () => {
    const oldGames = { active: [{ gameId: "OLD" }], finished: [] };
    const newGames = { active: [], finished: [] };
    mockListMultiplayerGames
      .mockResolvedValueOnce({ games: oldGames })
      .mockResolvedValueOnce({ games: newGames });

    const { result, rerender } = renderHook(({ auth }) => useGamesIndex(auth), {
      initialProps: { auth: mockAuth as AuthResponse | null },
    });

    // Wait for initial load with old user's games
    await waitFor(() => {
      expect(result.current.multiplayerGamesLoaded).toBe(true);
    });
    expect(result.current.multiplayerGames.active).toHaveLength(1);
    expect(result.current.multiplayerGames.active[0].gameId).toBe("OLD");

    // Simulate logout → new anonymous session (different playerId)
    const newAuth: AuthResponse = {
      player: {
        kind: "guest",
        playerId: "anon-new",
        displayName: "Guest",
      } as AuthResponse["player"],
    };
    rerender({ auth: newAuth });

    // The identity change effect should clear games and trigger a re-fetch
    await waitFor(() => {
      expect(result.current.multiplayerGamesLoaded).toBe(true);
    });
    expect(result.current.multiplayerGames.active).toEqual([]);
    expect(mockListMultiplayerGames).toHaveBeenCalledTimes(2);
  });

  it("retries up to 3 times then stops on persistent error", async () => {
    mockListMultiplayerGames.mockRejectedValue(new Error("502 Bad Gateway"));

    const { result } = renderHook(() => useGamesIndex(mockAuth));

    // Wait for all retries to complete (1 initial + 3 retries = 4 calls)
    await waitFor(
      () => {
        expect(result.current.multiplayerGamesLoaded).toBe(true);
      },
      { timeout: 15000 },
    );

    // Should have been called 4 times total (1 + 3 retries), not infinitely
    expect(mockListMultiplayerGames).toHaveBeenCalledTimes(4);

    // Wait extra time to confirm no additional calls are made
    await new Promise((r) => setTimeout(r, 200));
    expect(mockListMultiplayerGames).toHaveBeenCalledTimes(4);
  });

  it("refreshMultiplayerGames resets state when auth becomes null", async () => {
    const games = { active: [{ gameId: "X" }], finished: [] };
    mockListMultiplayerGames.mockResolvedValue({ games });

    const { result, rerender } = renderHook(({ auth }) => useGamesIndex(auth), {
      initialProps: { auth: mockAuth as AuthResponse | null },
    });

    await waitFor(() => {
      expect(result.current.multiplayerGamesLoaded).toBe(true);
    });

    // Now switch to unauthenticated
    rerender({ auth: null });

    await act(async () => {
      await result.current.refreshMultiplayerGames();
    });

    expect(result.current.multiplayerGames).toEqual({
      active: [],
      finished: [],
    });
  });
});
