import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMultiplayerGame } from "./useMultiplayerGame";
import type { AuthResponse, MultiplayerSnapshot } from "@shared";
import { createInitialGameState } from "@shared";

// Mock WebSocket
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;

  url: string;
  readyState = 1;
  sentMessages: string[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
  onerror: (() => void) | null = null;

  private eventListeners: Record<string, Function[]> = {};

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Function) {
    if (!this.eventListeners[type]) {
      this.eventListeners[type] = [];
    }
    this.eventListeners[type].push(listener);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = 3;
    const listeners = this.eventListeners["close"] || [];
    for (const listener of listeners) {
      listener({ code: 1000, reason: "", wasClean: true });
    }
  }

  simulateOpen() {
    const listeners = this.eventListeners["open"] || [];
    for (const listener of listeners) {
      listener();
    }
  }

  simulateMessage(data: unknown) {
    const listeners = this.eventListeners["message"] || [];
    for (const listener of listeners) {
      listener({ data: JSON.stringify(data) });
    }
  }

  simulateClose(code = 1000) {
    this.readyState = 3;
    const listeners = this.eventListeners["close"] || [];
    for (const listener of listeners) {
      listener({ code, reason: "", wasClean: code === 1000 });
    }
  }
}

vi.mock("../api", () => ({
  buildWebSocketUrl: (gameId: string) => `ws://localhost:5005/api/ws?gameId=${gameId}`,
  accessMultiplayerGame: vi.fn(),
}));

vi.mock("../errors", () => ({
  toastError: vi.fn(),
  readableError: (e: unknown) => String(e),
  isNetworkError: () => false,
}));

vi.mock("../../components/game/GameShared", () => ({
  createOptimisticSnapshot: (snapshot: MultiplayerSnapshot, nextState: any) => ({
    ...snapshot,
    state: nextState,
  }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

const mockAuth: AuthResponse = {
  player: {
    kind: "account",
    playerId: "player-1",
    displayName: "Test User",
  },
};

function createMockSnapshot(
  overrides: Partial<MultiplayerSnapshot> = {},
): MultiplayerSnapshot {
  return {
    gameId: "ABC123",
    roomType: "direct",
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    state: createInitialGameState(),
    players: [
      { player: mockAuth.player, online: true },
      {
        player: { playerId: "player-2", displayName: "Opponent", kind: "account" },
        online: true,
      },
    ],
    rematch: null,
    takeback: null,
    seats: {
      white: { player: mockAuth.player, online: true },
      black: {
        player: { playerId: "player-2", displayName: "Opponent", kind: "account" },
        online: true,
      },
    },
    timeControl: null,
    clock: null,
    ...overrides,
  };
}

describe("useMultiplayerGame", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("initializes with idle connection state", () => {
    const { result } = renderHook(() =>
      useMultiplayerGame(mockAuth, "ABC123"),
    );
    expect(result.current.connectionState).toBe("idle");
    expect(result.current.multiplayerSnapshot).toBeNull();
  });

  it("connects to room and transitions to connecting state", () => {
    const { result } = renderHook(() =>
      useMultiplayerGame(mockAuth, "ABC123"),
    );

    const snapshot = createMockSnapshot();
    act(() => {
      result.current.connectToRoom(snapshot);
    });

    expect(result.current.connectionState).toBe("connecting");
    expect(result.current.multiplayerSnapshot).not.toBeNull();
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("transitions to connected on socket open", () => {
    const { result } = renderHook(() =>
      useMultiplayerGame(mockAuth, "ABC123"),
    );

    const snapshot = createMockSnapshot();
    act(() => {
      result.current.connectToRoom(snapshot);
    });

    act(() => {
      MockWebSocket.instances[0].simulateOpen();
    });

    expect(result.current.connectionState).toBe("connected");
  });

  it("updates snapshot on server snapshot message", () => {
    const { result } = renderHook(() =>
      useMultiplayerGame(mockAuth, "ABC123"),
    );

    const snapshot = createMockSnapshot();
    act(() => {
      result.current.connectToRoom(snapshot);
    });

    const updatedSnapshot = createMockSnapshot({
      state: { ...createInitialGameState(), currentTurn: "black" },
    });

    act(() => {
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        snapshot: updatedSnapshot,
      });
    });

    expect(result.current.multiplayerSnapshot?.state.currentTurn).toBe("black");
  });

  it("sets error on server error message", () => {
    const { result } = renderHook(() =>
      useMultiplayerGame(mockAuth, "ABC123"),
    );

    const snapshot = createMockSnapshot();
    act(() => {
      result.current.connectToRoom(snapshot);
    });

    act(() => {
      MockWebSocket.instances[0].simulateMessage({
        type: "error",
        code: "NOT_YOUR_TURN",
        message: "It is not your turn.",
      });
    });

    expect(result.current.multiplayerError).toBe("It is not your turn.");
  });

  it("sends message via WebSocket", () => {
    const { result } = renderHook(() =>
      useMultiplayerGame(mockAuth, "ABC123"),
    );

    const snapshot = createMockSnapshot();
    act(() => {
      result.current.connectToRoom(snapshot);
    });

    act(() => {
      MockWebSocket.instances[0].simulateOpen();
    });

    act(() => {
      result.current.sendMultiplayerMessage({
        type: "place-piece",
        position: { x: 9, y: 9 },
      });
    });

    const socket = MockWebSocket.instances[0];
    expect(socket.sentMessages).toHaveLength(1);
    const msg = JSON.parse(socket.sentMessages[0]);
    expect(msg.type).toBe("place-piece");
    expect(msg.position).toEqual({ x: 9, y: 9 });
  });

  it("applies optimistic update on send", () => {
    const { result } = renderHook(() =>
      useMultiplayerGame(mockAuth, "ABC123"),
    );

    const snapshot = createMockSnapshot();
    act(() => {
      result.current.connectToRoom(snapshot);
    });

    act(() => {
      MockWebSocket.instances[0].simulateOpen();
    });

    act(() => {
      result.current.sendMultiplayerMessage({
        type: "place-piece",
        position: { x: 9, y: 9 },
      });
    });

    // Optimistic update should have changed the state
    expect(result.current.multiplayerSnapshot?.state.currentTurn).toBe("black");
    expect(result.current.multiplayerSnapshot?.state.positions[9][9]).toBe("white");
  });

  it("transitions to disconnected on close", () => {
    const { result } = renderHook(() =>
      useMultiplayerGame(mockAuth, "ABC123"),
    );

    const snapshot = createMockSnapshot();
    act(() => {
      result.current.connectToRoom(snapshot);
    });

    act(() => {
      MockWebSocket.instances[0].simulateOpen();
    });

    act(() => {
      MockWebSocket.instances[0].simulateClose(1006);
    });

    expect(result.current.connectionState).toBe("disconnected");
  });

  it("sets error when sending on closed socket", () => {
    const { result } = renderHook(() =>
      useMultiplayerGame(mockAuth, "ABC123"),
    );

    // Don't connect — socket is null
    act(() => {
      result.current.sendMultiplayerMessage({
        type: "place-piece",
        position: { x: 9, y: 9 },
      });
    });

    expect(result.current.multiplayerError).toBe("Connection not ready.");
  });

  it("cleans up socket on unmount", () => {
    const { result, unmount } = renderHook(() =>
      useMultiplayerGame(mockAuth, "ABC123"),
    );

    const snapshot = createMockSnapshot();
    act(() => {
      result.current.connectToRoom(snapshot);
    });

    const socket = MockWebSocket.instances[0];
    const closeSpy = vi.spyOn(socket, "close");

    unmount();
    expect(closeSpy).toHaveBeenCalled();
  });
});
