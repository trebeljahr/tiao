import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { AuthResponse } from "@shared";
import { LobbySocketProvider, useLobbyMessage } from "./LobbySocketContext";

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  close() {
    this.onclose?.();
  }

  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

vi.mock("./api", () => ({
  buildWebSocketUrl: (gameId: string) => `ws://localhost:5005/api/ws?gameId=${gameId}`,
}));

const mockAccountAuth: AuthResponse = {
  player: {
    kind: "account",
    playerId: "player-1",
    displayName: "Test User",
  },
};

const mockGuestAuth: AuthResponse = {
  player: {
    kind: "guest",
    playerId: "guest-1",
    displayName: "Guest",
  },
};

function createWrapper(auth: AuthResponse | null) {
  return ({ children }: { children: React.ReactNode }) => (
    <LobbySocketProvider auth={auth}>{children}</LobbySocketProvider>
  );
}

describe("LobbySocketProvider", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("connects when auth is an account player", () => {
    const handler = vi.fn();
    renderHook(() => useLobbyMessage(handler), {
      wrapper: createWrapper(mockAccountAuth),
    });

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toContain("/api/ws/lobby");
  });

  it("does not connect for guest players", () => {
    const handler = vi.fn();
    renderHook(() => useLobbyMessage(handler), {
      wrapper: createWrapper(mockGuestAuth),
    });

    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("does not connect when auth is null", () => {
    const handler = vi.fn();
    renderHook(() => useLobbyMessage(handler), {
      wrapper: createWrapper(null),
    });

    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("dispatches game-update messages to subscribers", () => {
    const handler = vi.fn();
    renderHook(() => useLobbyMessage(handler), {
      wrapper: createWrapper(mockAccountAuth),
    });

    const socket = MockWebSocket.instances[0];
    const payload = {
      type: "game-update",
      summary: {
        gameId: "ABC123",
        status: "active",
        yourSeat: "white",
        currentTurn: "black",
        seats: { white: null, black: null },
      },
    };

    act(() => {
      socket.simulateMessage(payload);
    });

    expect(handler).toHaveBeenCalledWith(payload);
  });

  it("dispatches social-update messages to subscribers", () => {
    const handler = vi.fn();
    renderHook(() => useLobbyMessage(handler), {
      wrapper: createWrapper(mockAccountAuth),
    });

    const socket = MockWebSocket.instances[0];
    const payload = {
      type: "social-update",
      overview: {
        friends: [],
        incomingFriendRequests: [],
        outgoingFriendRequests: [],
        incomingInvitations: [],
        outgoingInvitations: [],
      },
    };

    act(() => {
      socket.simulateMessage(payload);
    });

    expect(handler).toHaveBeenCalledWith(payload);
  });

  it("closes socket on unmount", () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useLobbyMessage(handler), {
      wrapper: createWrapper(mockAccountAuth),
    });

    const socket = MockWebSocket.instances[0];
    const closeSpy = vi.spyOn(socket, "close");

    unmount();

    expect(closeSpy).toHaveBeenCalled();
  });

  it("only opens one connection for multiple subscribers", () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    const wrapper = createWrapper(mockAccountAuth);
    renderHook(
      () => {
        useLobbyMessage(handler1);
        useLobbyMessage(handler2);
      },
      { wrapper },
    );

    expect(MockWebSocket.instances).toHaveLength(1);

    const socket = MockWebSocket.instances[0];
    const payload = { type: "game-update", summary: {} };

    act(() => {
      socket.simulateMessage(payload);
    });

    expect(handler1).toHaveBeenCalledWith(payload);
    expect(handler2).toHaveBeenCalledWith(payload);
  });
});
