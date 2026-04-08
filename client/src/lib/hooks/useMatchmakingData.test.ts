import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMatchmakingData } from "./useMatchmakingData";
import type { AuthResponse, LobbyClientMessage, MultiplayerSnapshot } from "@shared";

// Shared handles + state used by the mock below. The mock of
// ./../LobbySocketContext is hoisted by vitest, so we reach into these refs
// from inside tests to drive inbound messages and inspect outbound sends.
const sendMessageMock = vi.fn<(message: LobbyClientMessage) => void>();
let lobbyHandler: ((payload: Record<string, unknown>) => void) | null = null;

vi.mock("../LobbySocketContext", () => ({
  useLobbySocket: () => ({
    sendMessage: sendMessageMock,
    subscribe: (handler: (payload: Record<string, unknown>) => void) => {
      lobbyHandler = handler;
      return () => {
        lobbyHandler = null;
      };
    },
  }),
  useLobbyMessage: (handler: (payload: Record<string, unknown>) => void) => {
    lobbyHandler = handler;
  },
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

function pushMessage(payload: Record<string, unknown>) {
  if (lobbyHandler) lobbyHandler(payload);
}

describe("useMatchmakingData (lobby socket)", () => {
  beforeEach(() => {
    sendMessageMock.mockReset();
    lobbyHandler = null;
  });

  it("initializes with idle status", () => {
    const onMatched = vi.fn();
    const { result } = renderHook(() => useMatchmakingData(mockAuth, onMatched));
    expect(result.current.matchmaking.status).toBe("idle");
    expect(result.current.matchmakingBusy).toBe(false);
  });

  it("sends matchmaking:enter when entering and updates state on ack", async () => {
    const onMatched = vi.fn();
    const { result } = renderHook(() => useMatchmakingData(mockAuth, onMatched));

    await act(async () => {
      await result.current.handleEnterMatchmaking();
    });

    expect(sendMessageMock).toHaveBeenCalledWith({
      type: "matchmaking:enter",
      timeControl: null,
    });

    act(() => {
      pushMessage({
        type: "matchmaking:state",
        state: { status: "searching", queuedAt: new Date().toISOString() },
      });
    });

    expect(result.current.matchmaking.status).toBe("searching");
    expect(result.current.matchmakingBusy).toBe(false);
  });

  it("forwards timeControl in matchmaking:enter", async () => {
    const onMatched = vi.fn();
    const { result } = renderHook(() => useMatchmakingData(mockAuth, onMatched));
    const tc = { initialMs: 300_000, incrementMs: 3_000 };

    await act(async () => {
      await result.current.handleEnterMatchmaking(tc);
    });

    expect(sendMessageMock).toHaveBeenCalledWith({
      type: "matchmaking:enter",
      timeControl: tc,
    });
  });

  it("calls onMatched when matchmaking:matched arrives", async () => {
    const onMatched = vi.fn();
    const { result } = renderHook(() => useMatchmakingData(mockAuth, onMatched));

    await act(async () => {
      await result.current.handleEnterMatchmaking();
    });

    act(() => {
      pushMessage({ type: "matchmaking:matched", snapshot: mockSnapshot });
    });

    expect(onMatched).toHaveBeenCalledWith(mockSnapshot);
    expect(result.current.matchmaking.status).toBe("matched");
  });

  it("cancel sends matchmaking:leave and flips to idle optimistically", async () => {
    const onMatched = vi.fn();
    const { result } = renderHook(() => useMatchmakingData(mockAuth, onMatched));

    await act(async () => {
      await result.current.handleEnterMatchmaking();
    });
    act(() => {
      pushMessage({
        type: "matchmaking:state",
        state: { status: "searching", queuedAt: new Date().toISOString() },
      });
    });

    sendMessageMock.mockClear();

    await act(async () => {
      await result.current.handleCancelMatchmaking();
    });

    expect(sendMessageMock).toHaveBeenCalledWith({ type: "matchmaking:leave" });
    expect(result.current.matchmaking.status).toBe("idle");
  });

  it("unmount while searching sends matchmaking:leave", async () => {
    const onMatched = vi.fn();
    const { result, unmount } = renderHook(() => useMatchmakingData(mockAuth, onMatched));

    await act(async () => {
      await result.current.handleEnterMatchmaking();
    });
    act(() => {
      pushMessage({
        type: "matchmaking:state",
        state: { status: "searching", queuedAt: new Date().toISOString() },
      });
    });

    sendMessageMock.mockClear();
    unmount();

    expect(sendMessageMock).toHaveBeenCalledWith({ type: "matchmaking:leave" });
  });

  it("unmount after matched does NOT send matchmaking:leave", async () => {
    const onMatched = vi.fn();
    const { result, unmount } = renderHook(() => useMatchmakingData(mockAuth, onMatched));

    await act(async () => {
      await result.current.handleEnterMatchmaking();
    });
    act(() => {
      pushMessage({ type: "matchmaking:matched", snapshot: mockSnapshot });
    });

    sendMessageMock.mockClear();
    unmount();

    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("unmount while idle does not send anything", () => {
    const onMatched = vi.fn();
    const { unmount } = renderHook(() => useMatchmakingData(mockAuth, onMatched));
    unmount();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("matchmaking:error pops a toast and resets to idle", async () => {
    const onMatched = vi.fn();
    const { result } = renderHook(() => useMatchmakingData(mockAuth, onMatched));

    await act(async () => {
      await result.current.handleEnterMatchmaking();
    });
    act(() => {
      pushMessage({
        type: "matchmaking:error",
        code: "ERR",
        message: "Something broke",
      });
    });

    expect(result.current.matchmaking.status).toBe("idle");
    expect(result.current.matchmakingBusy).toBe(false);
  });

  it("does nothing when auth is null", async () => {
    const onMatched = vi.fn();
    const { result } = renderHook(() => useMatchmakingData(null, onMatched));

    await act(async () => {
      await result.current.handleEnterMatchmaking();
    });

    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("matchmaking:preempted flips to idle + preempted and fires onPreempted", async () => {
    // Preemption happens when a second tab/browser of the same account enters
    // matchmaking — the server evicts the old socket and sends
    // `matchmaking:preempted`. The old tab must flip to idle *and* set a
    // sticky preempted flag so its auto-re-enter effect (in MatchmakingPage)
    // doesn't immediately kick the other tab out again.
    const onMatched = vi.fn();
    const onPreempted = vi.fn();
    const { result } = renderHook(() => useMatchmakingData(mockAuth, onMatched, onPreempted));

    await act(async () => {
      await result.current.handleEnterMatchmaking();
    });
    act(() => {
      pushMessage({
        type: "matchmaking:state",
        state: { status: "searching", queuedAt: new Date().toISOString() },
      });
    });
    expect(result.current.matchmaking.status).toBe("searching");
    expect(result.current.preempted).toBe(false);

    act(() => {
      pushMessage({ type: "matchmaking:preempted" });
    });

    expect(result.current.matchmaking.status).toBe("idle");
    expect(result.current.matchmakingBusy).toBe(false);
    expect(result.current.preempted).toBe(true);
    expect(onPreempted).toHaveBeenCalledTimes(1);
  });

  it("unmount after preempted does NOT send matchmaking:leave", async () => {
    // After preemption we're not the queue owner anymore (the other tab is),
    // so we shouldn't send a stray leave that the server would silently
    // ignore. The status is already idle, so the existing
    // `statusRef.current === 'searching'` gate handles this naturally —
    // regression-guarded here in case someone re-wires the unmount effect.
    const onMatched = vi.fn();
    const onPreempted = vi.fn();
    const { result, unmount } = renderHook(() =>
      useMatchmakingData(mockAuth, onMatched, onPreempted),
    );

    await act(async () => {
      await result.current.handleEnterMatchmaking();
    });
    act(() => {
      pushMessage({
        type: "matchmaking:state",
        state: { status: "searching", queuedAt: new Date().toISOString() },
      });
    });
    act(() => {
      pushMessage({ type: "matchmaking:preempted" });
    });

    expect(result.current.preempted).toBe(true);
    sendMessageMock.mockClear();
    unmount();

    expect(sendMessageMock).not.toHaveBeenCalled();
  });
});
