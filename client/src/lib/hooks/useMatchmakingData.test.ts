import type { AuthResponse, LobbyClientMessage, MultiplayerSnapshot } from "@shared";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMatchmakingData } from "./useMatchmakingData";

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
    window.sessionStorage.clear();
  });

  it("uses secure UUID bytes in native WebViews without randomUUID", async () => {
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, "randomUUID", { configurable: true, value: undefined });
    try {
      const { result } = renderHook(() => useMatchmakingData(mockAuth, vi.fn()));
      await act(async () => {
        await result.current.handleEnterMatchmaking();
      });
      expect(sendMessageMock.mock.calls[0][0]).toMatchObject({
        type: "matchmaking:enter-v2",
        attemptId: expect.stringMatching(
          /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
        ),
      });
    } finally {
      Object.defineProperty(crypto, "randomUUID", { configurable: true, value: original });
    }
  });

  it("does not resume an old search after account changes", async () => {
    const { result, rerender } = renderHook(({ auth }) => useMatchmakingData(auth, vi.fn()), {
      initialProps: { auth: mockAuth },
    });
    await act(async () => {
      await result.current.handleEnterMatchmaking();
    });
    rerender({ auth: { player: { ...mockAuth.player, playerId: "different-account" } } });
    sendMessageMock.mockClear();
    act(() => pushMessage({ type: "lobby:open" }));
    expect(sendMessageMock).not.toHaveBeenCalled();
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
      type: "matchmaking:enter-v2",
      attemptId: expect.any(String),
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
      type: "matchmaking:enter-v2",
      attemptId: expect.any(String),
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

  it("matchmaking:error pops a toast, resets to idle and backs off before retrying", async () => {
    vi.useFakeTimers();
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
    // Busy holds the page's auto-enter back so a persistent error cannot spin.
    expect(result.current.matchmakingBusy).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.matchmakingBusy).toBe(false);
    vi.useRealTimers();
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

  it("matchmaking:resumable clears the sticky preempted flag", async () => {
    // When the tab that preempted us later cancels/disconnects without
    // matching, the server pushes `matchmaking:resumable`. That clears the
    // sticky flag so the MatchmakingPage's auto-re-enter effect can fire
    // again and put us back into the queue.
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
    act(() => {
      pushMessage({ type: "matchmaking:preempted" });
    });
    expect(result.current.preempted).toBe(true);

    act(() => {
      pushMessage({ type: "matchmaking:resumable" });
    });

    expect(result.current.preempted).toBe(false);
    // Status stays idle until the page re-enters — this message is just an
    // unblock signal, not a state change.
    expect(result.current.matchmaking.status).toBe("idle");
  });
});

describe("rolling matchmaking recovery", () => {
  beforeEach(() => {
    sendMessageMock.mockReset();
    lobbyHandler = null;
    window.sessionStorage.clear();
  });
  it("resends the same search id and input after a lost acknowledgement", async () => {
    const { result } = renderHook(() => useMatchmakingData(mockAuth, vi.fn()));
    await act(async () => {
      await result.current.handleEnterMatchmaking({ initialMs: 300000, incrementMs: 3000 });
    });
    const first = sendMessageMock.mock.calls[0][0];
    expect(first).toHaveProperty("attemptId", expect.any(String));
    act(() => pushMessage({ type: "lobby:open" }));
    expect(sendMessageMock.mock.calls[1][0]).toEqual(first);
    act(() => pushMessage({ type: "matchmaking:matched", snapshot: mockSnapshot }));
    act(() => pushMessage({ type: "lobby:open" }));
    expect(sendMessageMock).toHaveBeenCalledTimes(2);
  });
  it("cancellation and preemption prevent reconnect from restarting the old search", async () => {
    const { result } = renderHook(() => useMatchmakingData(mockAuth, vi.fn()));
    await act(async () => {
      await result.current.handleEnterMatchmaking();
    });
    const first = sendMessageMock.mock.calls[0][0];
    await act(async () => {
      await result.current.handleCancelMatchmaking();
    });
    act(() => pushMessage({ type: "lobby:open" }));
    expect(sendMessageMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      await result.current.handleEnterMatchmaking();
    });
    expect(sendMessageMock.mock.calls[2][0]).not.toEqual(first);
    act(() => pushMessage({ type: "matchmaking:preempted" }));
    act(() => pushMessage({ type: "lobby:open" }));
    expect(sendMessageMock).toHaveBeenCalledTimes(3);
  });
});

it("ignores a delayed matched notification from an older search", async () => {
  sendMessageMock.mockReset();
  window.sessionStorage.clear();
  const onMatched = vi.fn();
  const { result } = renderHook(() => useMatchmakingData(mockAuth, onMatched));
  await act(async () => {
    await result.current.handleEnterMatchmaking();
  });
  const first = sendMessageMock.mock.calls[0][0] as { attemptId: string };
  await act(async () => {
    await result.current.handleCancelMatchmaking();
    await result.current.handleEnterMatchmaking();
  });
  act(() =>
    pushMessage({
      type: "matchmaking:matched",
      snapshot: mockSnapshot,
      attemptId: first.attemptId,
    }),
  );
  expect(onMatched).not.toHaveBeenCalled();
});

describe("reload-safe matchmaking intent", () => {
  const timeControl = { initialMs: 300000, incrementMs: 3000 };
  beforeEach(() => {
    sendMessageMock.mockReset();
    lobbyHandler = null;
    window.sessionStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const sent = (index: number) =>
    sendMessageMock.mock.calls[index][0] as { attemptId: string; timeControl: unknown };

  it("saves the search before the first send and resumes it after a full reload", async () => {
    sendMessageMock.mockImplementationOnce((message) => {
      // The id must already be durable when the server can first observe it.
      expect(window.sessionStorage.getItem("tiao:matchmaking-search:v1")).toContain(
        (message as { attemptId: string }).attemptId,
      );
    });
    const beforeReload = renderHook(() => useMatchmakingData(mockAuth, vi.fn()));
    await act(async () => {
      await beforeReload.result.current.handleEnterMatchmaking(timeControl);
    });
    // A full navigation discards React state without running unmount cleanup.
    const afterReload = renderHook(() => useMatchmakingData(mockAuth, vi.fn()));
    await act(async () => {
      await afterReload.result.current.handleEnterMatchmaking(timeControl);
    });
    expect(sent(1)).toEqual(sent(0));
  });

  it("restores the search when auth hydrates after the reload", async () => {
    const first = renderHook(() => useMatchmakingData(mockAuth, vi.fn()));
    await act(async () => {
      await first.result.current.handleEnterMatchmaking(timeControl);
    });
    const reloaded = renderHook(({ auth }) => useMatchmakingData(auth, vi.fn()), {
      initialProps: { auth: null as AuthResponse | null },
    });
    reloaded.rerender({ auth: mockAuth });
    await act(async () => {
      await reloaded.result.current.handleEnterMatchmaking(timeControl);
    });
    expect(sent(1).attemptId).toBe(sent(0).attemptId);
  });

  it("never resumes another account's search or one with a different time control", async () => {
    const first = renderHook(() => useMatchmakingData(mockAuth, vi.fn()));
    await act(async () => {
      await first.result.current.handleEnterMatchmaking(timeControl);
    });
    const otherAccount = renderHook(() =>
      useMatchmakingData({ player: { ...mockAuth.player, playerId: "player-2" } }, vi.fn()),
    );
    await act(async () => {
      await otherAccount.result.current.handleEnterMatchmaking(timeControl);
    });
    expect(sent(1).attemptId).not.toBe(sent(0).attemptId);
    const otherInput = renderHook(() => useMatchmakingData(mockAuth, vi.fn()));
    await act(async () => {
      await otherInput.result.current.handleEnterMatchmaking(null);
    });
    expect(sent(2).attemptId).not.toBe(sent(0).attemptId);
  });

  it("logout forgets the saved search", async () => {
    const view = renderHook(({ auth }) => useMatchmakingData(auth, vi.fn()), {
      initialProps: { auth: mockAuth as AuthResponse | null },
    });
    await act(async () => {
      await view.result.current.handleEnterMatchmaking(timeControl);
    });
    view.rerender({ auth: null });
    const reloaded = renderHook(() => useMatchmakingData(mockAuth, vi.fn()));
    await act(async () => {
      await reloaded.result.current.handleEnterMatchmaking(timeControl);
    });
    expect(sent(1).attemptId).not.toBe(sent(0).attemptId);
  });

  it("still searches in memory when storage refuses the write", async () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => null,
      removeItem: () => undefined,
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
    });
    const { result } = renderHook(() => useMatchmakingData(mockAuth, vi.fn()));
    await act(async () => {
      await result.current.handleEnterMatchmaking(timeControl);
    });
    expect(sent(0)).toMatchObject({ type: "matchmaking:enter-v2", timeControl });
    act(() => pushMessage({ type: "lobby:open" }));
    expect(sent(1)).toEqual(sent(0));
  });

  it("a superseded search behaves like preemption and is forgotten", async () => {
    const onPreempted = vi.fn();
    const { result } = renderHook(() => useMatchmakingData(mockAuth, vi.fn(), onPreempted));
    await act(async () => {
      await result.current.handleEnterMatchmaking(timeControl);
    });
    act(() =>
      pushMessage({
        type: "matchmaking:error",
        code: "SEARCH_SUPERSEDED",
        message: "replaced",
        attemptId: sent(0).attemptId,
      }),
    );
    expect(result.current.preempted).toBe(true);
    expect(onPreempted).toHaveBeenCalled();
    expect(window.sessionStorage.getItem("tiao:matchmaking-search:v1")).toBeNull();
    act(() => pushMessage({ type: "lobby:open" }));
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
  });

  it("matched and cancelled searches are not resumed after reload", async () => {
    const view = renderHook(() => useMatchmakingData(mockAuth, vi.fn()));
    await act(async () => {
      await view.result.current.handleEnterMatchmaking(timeControl);
    });
    act(() => pushMessage({ type: "matchmaking:matched", snapshot: mockSnapshot }));
    expect(window.sessionStorage.getItem("tiao:matchmaking-search:v1")).toBeNull();
    await act(async () => {
      await view.result.current.handleEnterMatchmaking(timeControl);
      await view.result.current.handleCancelMatchmaking();
    });
    expect(window.sessionStorage.getItem("tiao:matchmaking-search:v1")).toBeNull();
  });
});
