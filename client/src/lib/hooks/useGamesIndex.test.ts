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
