import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMatchmakingData } from "./useMatchmakingData";
import type { AuthResponse, MultiplayerSnapshot } from "@shared";

const mockEnterMatchmaking = vi.fn();
const mockLeaveMatchmaking = vi.fn();
const mockGetMatchmakingState = vi.fn();

vi.mock("../api", () => ({
  enterMatchmaking: (...args: unknown[]) => mockEnterMatchmaking(...args),
  leaveMatchmaking: (...args: unknown[]) => mockLeaveMatchmaking(...args),
  getMatchmakingState: (...args: unknown[]) => mockGetMatchmakingState(...args),
}));

vi.mock("../errors", () => ({
  toastError: vi.fn(),
}));

const mockAuth: AuthResponse = {
  player: {
    kind: "account",
    playerId: "player-1",
    displayName: "Test User",
  },
};

const mockSnapshot = {
  gameId: "ABC123",
  roomType: "matchmaking",
  status: "active",
  state: { currentTurn: "white" },
  players: [],
  spectators: [],
  seats: { white: null, black: null },
  rematch: null,
  takeback: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} as unknown as MultiplayerSnapshot;

describe("useMatchmakingData", () => {
  beforeEach(() => {
    mockEnterMatchmaking.mockReset();
    mockLeaveMatchmaking.mockReset();
    mockGetMatchmakingState.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("initializes with idle status", () => {
    const onMatched = vi.fn();
    const { result } = renderHook(() => useMatchmakingData(mockAuth, onMatched));
    expect(result.current.matchmaking.status).toBe("idle");
    expect(result.current.matchmakingBusy).toBe(false);
  });

  it("enters matchmaking and sets searching status", async () => {
    mockEnterMatchmaking.mockResolvedValue({
      matchmaking: { status: "searching", queuedAt: new Date().toISOString() },
    });

    const onMatched = vi.fn();
    const { result } = renderHook(() => useMatchmakingData(mockAuth, onMatched));

    await act(async () => {
      await result.current.handleEnterMatchmaking();
    });

    expect(result.current.matchmaking.status).toBe("searching");
    expect(mockEnterMatchmaking).toHaveBeenCalledTimes(1);
  });

  it("calls onMatched when immediately matched", async () => {
    mockEnterMatchmaking.mockResolvedValue({
      matchmaking: { status: "matched", snapshot: mockSnapshot },
    });
    mockLeaveMatchmaking.mockResolvedValue(undefined);

    const onMatched = vi.fn();
    const { result } = renderHook(() => useMatchmakingData(mockAuth, onMatched));

    await act(async () => {
      await result.current.handleEnterMatchmaking();
    });

    expect(onMatched).toHaveBeenCalledWith(mockSnapshot);
  });

  it("does not enter matchmaking when auth is null", async () => {
    const onMatched = vi.fn();
    const { result } = renderHook(() => useMatchmakingData(null, onMatched));

    await act(async () => {
      await result.current.handleEnterMatchmaking();
    });

    expect(mockEnterMatchmaking).not.toHaveBeenCalled();
  });

  it("cancels matchmaking and returns to idle", async () => {
    mockEnterMatchmaking.mockResolvedValue({
      matchmaking: { status: "searching", queuedAt: new Date().toISOString() },
    });
    mockLeaveMatchmaking.mockResolvedValue(undefined);

    const onMatched = vi.fn();
    const { result } = renderHook(() => useMatchmakingData(mockAuth, onMatched));

    await act(async () => {
      await result.current.handleEnterMatchmaking();
    });
    expect(result.current.matchmaking.status).toBe("searching");

    await act(async () => {
      await result.current.handleCancelMatchmaking();
    });

    expect(result.current.matchmaking.status).toBe("idle");
    expect(mockLeaveMatchmaking).toHaveBeenCalled();
  });

  it("polls for matchmaking status when searching", async () => {
    mockEnterMatchmaking.mockResolvedValue({
      matchmaking: { status: "searching", queuedAt: new Date().toISOString() },
    });
    mockGetMatchmakingState.mockResolvedValue({
      matchmaking: { status: "searching", queuedAt: new Date().toISOString() },
    });

    const onMatched = vi.fn();
    const { result } = renderHook(() => useMatchmakingData(mockAuth, onMatched));

    await act(async () => {
      await result.current.handleEnterMatchmaking();
    });

    // Advance past one poll interval (2000ms)
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });

    expect(mockGetMatchmakingState).toHaveBeenCalled();
  });

  it("stops polling and calls onMatched when match found via poll", async () => {
    mockEnterMatchmaking.mockResolvedValue({
      matchmaking: { status: "searching", queuedAt: new Date().toISOString() },
    });
    mockGetMatchmakingState.mockResolvedValue({
      matchmaking: { status: "matched", snapshot: mockSnapshot },
    });

    const onMatched = vi.fn();
    const { result } = renderHook(() => useMatchmakingData(mockAuth, onMatched));

    await act(async () => {
      await result.current.handleEnterMatchmaking();
    });

    // Advance to trigger poll
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });

    expect(onMatched).toHaveBeenCalledWith(mockSnapshot);
  });
});
