import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useGamesIndex } from "./useGamesIndex";
import type { AuthResponse } from "@shared";

// Capture lobby message handlers so tests can simulate WebSocket events.
const lobbyMessageHandlers: Array<(payload: Record<string, unknown>) => void> = [];

vi.mock("../LobbySocketContext", () => ({
  useLobbyMessage: (handler: (payload: Record<string, unknown>) => void) => {
    lobbyMessageHandlers.push(handler);
  },
}));

function simulateLobbyMessage(payload: Record<string, unknown>) {
  act(() => {
    for (const handler of lobbyMessageHandlers) {
      handler(payload);
    }
  });
}

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
  lobbyMessageHandlers.length = 0;
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

    // Flush pending microtasks so any effect-driven async code runs.
    // The hook's useEffect early-returns for null auth, so the mock
    // should not be called at all.
    await Promise.resolve();
    await Promise.resolve();
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

    // Should have been called 4 times total (1 + 3 retries), not infinitely.
    // Once multiplayerGamesLoaded flips to true, fetchWithRetry has
    // already exhausted the retry loop and thrown — no more timers
    // pending, so we don't need an extra sleep to "confirm".
    expect(mockListMultiplayerGames).toHaveBeenCalledTimes(4);
  });

  it("patches a player-identity-update into active/finished game seats", async () => {
    const games = {
      active: [
        {
          gameId: "ABC123",
          status: "active",
          seats: {
            white: {
              player: { playerId: "player-1", displayName: "Me", activeBadges: [] },
              online: true,
            },
            black: {
              player: { playerId: "opponent-42", displayName: "Opp", activeBadges: [] },
              online: true,
            },
          },
        },
      ],
      finished: [
        {
          gameId: "DEF456",
          status: "finished",
          seats: {
            white: {
              player: { playerId: "opponent-42", displayName: "Opp", activeBadges: [] },
              online: false,
            },
            black: {
              player: { playerId: "player-1", displayName: "Me", activeBadges: [] },
              online: false,
            },
          },
        },
      ],
    };
    mockListMultiplayerGames.mockResolvedValue({ games });

    const { result } = renderHook(() => useGamesIndex(mockAuth));

    await waitFor(() => {
      expect(result.current.multiplayerGamesLoaded).toBe(true);
    });

    // Opponent equips a new badge — server broadcasts player-identity-update
    simulateLobbyMessage({
      type: "player-identity-update",
      playerId: "opponent-42",
      activeBadges: ["super-supporter"],
    });

    expect(result.current.multiplayerGames.active[0].seats.black?.player.activeBadges).toEqual([
      "super-supporter",
    ]);
    expect(result.current.multiplayerGames.finished[0].seats.white?.player.activeBadges).toEqual([
      "super-supporter",
    ]);
    // Unrelated seat untouched
    expect(result.current.multiplayerGames.active[0].seats.white?.player.activeBadges).toEqual([]);
  });

  it("ignores player-identity-update for a playerId that isn't in any game", async () => {
    const games = {
      active: [
        {
          gameId: "ABC123",
          status: "active",
          seats: {
            white: {
              player: { playerId: "player-1", displayName: "Me", activeBadges: [] },
              online: true,
            },
            black: {
              player: { playerId: "opponent-42", displayName: "Opp", activeBadges: [] },
              online: true,
            },
          },
        },
      ],
      finished: [],
    };
    mockListMultiplayerGames.mockResolvedValue({ games });

    const { result } = renderHook(() => useGamesIndex(mockAuth));
    await waitFor(() => {
      expect(result.current.multiplayerGamesLoaded).toBe(true);
    });

    const before = result.current.multiplayerGames;
    simulateLobbyMessage({
      type: "player-identity-update",
      playerId: "some-stranger",
      activeBadges: ["supporter"],
    });

    // Reference equality: no new object was created because nothing was touched
    expect(result.current.multiplayerGames).toBe(before);
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
