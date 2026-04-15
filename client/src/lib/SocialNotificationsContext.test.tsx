import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import type { AuthResponse, SocialOverview } from "@shared";
import { SocialNotificationsProvider, useSocialNotifications } from "./SocialNotificationsContext";

// --- Mocks ---

const mockGetSocialOverview = vi.fn();
const mockAcceptFriendRequest = vi.fn();
const mockDeclineFriendRequest = vi.fn();
const mockDeclineGameInvitation = vi.fn();

vi.mock("./api", () => ({
  getSocialOverview: (...args: unknown[]) => mockGetSocialOverview(...args),
  acceptFriendRequest: (...args: unknown[]) => mockAcceptFriendRequest(...args),
  declineFriendRequest: (...args: unknown[]) => mockDeclineFriendRequest(...args),
  declineGameInvitation: (...args: unknown[]) => mockDeclineGameInvitation(...args),
}));

vi.mock("./errors", () => ({
  toastError: vi.fn(),
}));

vi.mock("sonner", () => {
  const toastFn = vi.fn() as ReturnType<typeof vi.fn> & {
    dismiss: ReturnType<typeof vi.fn>;
    success: ReturnType<typeof vi.fn>;
    custom: ReturnType<typeof vi.fn>;
  };
  toastFn.dismiss = vi.fn();
  toastFn.success = vi.fn();
  // `toast.custom` is used by the rematch toast path. Mock it so tests that
  // simulate game-update messages don't crash on `toast.custom is not a
  // function`.
  toastFn.custom = vi.fn();
  return { toast: toastFn };
});

// Capture useLobbyMessage handlers so we can simulate WebSocket messages.
// The provider registers multiple handlers (social-update + game-update).
const lobbyMessageHandlers: Array<(payload: Record<string, unknown>) => void> = [];

vi.mock("./LobbySocketContext", () => ({
  useLobbyMessage: (handler: (payload: Record<string, unknown>) => void) => {
    lobbyMessageHandlers.push(handler);
  },
}));

// --- Helpers ---

const accountAuth: AuthResponse = {
  player: {
    kind: "account",
    playerId: "my-player",
    displayName: "Me",
  },
};

const emptyOverview: SocialOverview = {
  friends: [],
  incomingFriendRequests: [],
  outgoingFriendRequests: [],
  incomingInvitations: [],
  outgoingInvitations: [],
};

function wrapper({ children }: { children: React.ReactNode }) {
  return <SocialNotificationsProvider auth={accountAuth}>{children}</SocialNotificationsProvider>;
}

function simulateLobbyMessage(payload: Record<string, unknown>) {
  act(() => {
    for (const handler of lobbyMessageHandlers) {
      handler(payload);
    }
  });
}

/**
 * Flush the provider's initial `fetchOverview()` promise chain inside an
 * `act` boundary. `renderHook`'s initial render wraps the useEffect schedule
 * in act, but the async `.then(setOverview)` that lands after
 * `getSocialOverview()` resolves runs in a later microtask — if tests just
 * `waitFor(() => expect(mockGetSocialOverview).toHaveBeenCalled())`, the
 * state update from the `.then()` fires outside act and floods stderr with
 * "An update to SocialNotificationsProvider inside a test was not wrapped in
 * act(...)" warnings. Awaiting two microtask ticks inside act lets the
 * hydration promise resolve AND the subsequent setState commit cleanly.
 */
async function flushHydration() {
  // Use a macrotask (setTimeout 0) so any number of chained microtasks
  // from the async fetchOverview() body all resolve before act exits.
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

// --- Tests ---

describe("SocialNotificationsContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lobbyMessageHandlers.length = 0;
    sessionStorage.clear();
    mockGetSocialOverview.mockResolvedValue({ overview: emptyOverview });
  });

  it("provides pending friend request count from overview", async () => {
    const overview: SocialOverview = {
      ...emptyOverview,
      incomingFriendRequests: [{ playerId: "req-1", displayName: "Alice" }],
    };
    mockGetSocialOverview.mockResolvedValue({ overview });

    const { result } = renderHook(() => useSocialNotifications(), { wrapper });

    await waitFor(() => {
      expect(result.current.pendingFriendRequestCount).toBe(1);
    });
  });

  it("shows toast for new incoming friend request via WebSocket", async () => {
    mockGetSocialOverview.mockResolvedValue({ overview: emptyOverview });

    renderHook(() => useSocialNotifications(), { wrapper });

    // Wait for initial hydration
    await flushHydration();

    // Simulate a social-update with a new friend request
    const updatedOverview: SocialOverview = {
      ...emptyOverview,
      incomingFriendRequests: [{ playerId: "alice-id", displayName: "Alice" }],
    };

    simulateLobbyMessage({ type: "social-update", overview: updatedOverview });

    // First arg is a JSX element (the <PlayerIdentityRow>) — not worth
    // asserting on at the object level. `description` is the meaningful
    // user-facing copy and we DO assert on it.
    expect(toast).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: "friend-request:alice-id",
        description: "sent you a friend request",
        duration: Infinity,
        dismissible: true,
      }),
    );
  });

  it("dismisses friend request toast when request is accepted elsewhere", async () => {
    // Start with one incoming friend request
    const initialOverview: SocialOverview = {
      ...emptyOverview,
      incomingFriendRequests: [{ playerId: "alice-id", displayName: "Alice" }],
    };
    mockGetSocialOverview.mockResolvedValue({ overview: initialOverview });

    renderHook(() => useSocialNotifications(), { wrapper });

    // Wait for hydration
    await flushHydration();

    // Now simulate a social-update where alice's request is gone (accepted from friends page)
    const updatedOverview: SocialOverview = {
      ...emptyOverview,
      friends: [{ playerId: "alice-id", displayName: "Alice" }],
      incomingFriendRequests: [],
    };

    simulateLobbyMessage({ type: "social-update", overview: updatedOverview });

    expect(toast.dismiss).toHaveBeenCalledWith("friend-request:alice-id");
  });

  it("dismisses friend request toast when request is declined elsewhere", async () => {
    const initialOverview: SocialOverview = {
      ...emptyOverview,
      incomingFriendRequests: [{ playerId: "bob-id", displayName: "Bob" }],
    };
    mockGetSocialOverview.mockResolvedValue({ overview: initialOverview });

    renderHook(() => useSocialNotifications(), { wrapper });

    await flushHydration();

    // Bob's request disappears (declined from another tab/page)
    simulateLobbyMessage({ type: "social-update", overview: emptyOverview });

    expect(toast.dismiss).toHaveBeenCalledWith("friend-request:bob-id");
  });

  it("dismisses only the removed friend request toasts, not others", async () => {
    const initialOverview: SocialOverview = {
      ...emptyOverview,
      incomingFriendRequests: [
        { playerId: "alice-id", displayName: "Alice" },
        { playerId: "bob-id", displayName: "Bob" },
      ],
    };
    mockGetSocialOverview.mockResolvedValue({ overview: initialOverview });

    renderHook(() => useSocialNotifications(), { wrapper });

    await flushHydration();

    // Only alice's request is accepted; bob's remains
    const updatedOverview: SocialOverview = {
      ...emptyOverview,
      incomingFriendRequests: [{ playerId: "bob-id", displayName: "Bob" }],
    };

    simulateLobbyMessage({ type: "social-update", overview: updatedOverview });

    expect(toast.dismiss).toHaveBeenCalledWith("friend-request:alice-id");
    expect(toast.dismiss).not.toHaveBeenCalledWith("friend-request:bob-id");
  });

  it("dismisses game invitation toast when invitation is no longer pending", async () => {
    const initialOverview: SocialOverview = {
      ...emptyOverview,
      incomingInvitations: [
        {
          id: "inv-1",
          gameId: "game-1",
          roomType: "direct",
          createdAt: "2026-01-01T00:00:00Z",
          expiresAt: "2026-01-02T00:00:00Z",
          sender: { playerId: "carol-id", displayName: "Carol" },
          recipient: { playerId: "my-player", displayName: "Me" },
        },
      ],
    };
    mockGetSocialOverview.mockResolvedValue({ overview: initialOverview });

    renderHook(() => useSocialNotifications(), { wrapper });

    await flushHydration();

    // Invitation is gone (declined from another page)
    simulateLobbyMessage({ type: "social-update", overview: emptyOverview });

    expect(toast.dismiss).toHaveBeenCalledWith("game-invitation:inv-1");
  });

  it("does not dismiss toasts when not hydrated yet", async () => {
    // Initial fetch returns empty, so hydration sets prevRequestIds to empty
    mockGetSocialOverview.mockResolvedValue({ overview: emptyOverview });

    renderHook(() => useSocialNotifications(), { wrapper });

    await flushHydration();

    // No previous IDs to dismiss, and new request appears
    const updatedOverview: SocialOverview = {
      ...emptyOverview,
      incomingFriendRequests: [{ playerId: "alice-id", displayName: "Alice" }],
    };

    simulateLobbyMessage({ type: "social-update", overview: updatedOverview });

    // Should not dismiss anything since no previous IDs existed
    expect(toast.dismiss).not.toHaveBeenCalled();
    // But should show the new toast
    expect(toast).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: "friend-request:alice-id",
        description: "sent you a friend request",
      }),
    );
  });

  it("assigns stable toast IDs to game invitation toasts", async () => {
    mockGetSocialOverview.mockResolvedValue({ overview: emptyOverview });

    renderHook(() => useSocialNotifications(), { wrapper });

    await flushHydration();

    const updatedOverview: SocialOverview = {
      ...emptyOverview,
      incomingInvitations: [
        {
          id: "inv-99",
          gameId: "game-99",
          roomType: "direct",
          createdAt: "2026-01-01T00:00:00Z",
          expiresAt: "2026-01-02T00:00:00Z",
          sender: { playerId: "dave-id", displayName: "Dave" },
          recipient: { playerId: "my-player", displayName: "Me" },
        },
      ],
    };

    simulateLobbyMessage({ type: "social-update", overview: updatedOverview });

    expect(toast).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: "game-invitation:inv-99",
        description: "invited you to a game (19×19, Unlimited, first to 10)",
      }),
    );
  });

  it("shows toasts for pending friend requests on fresh session (empty sessionStorage)", async () => {
    const overview: SocialOverview = {
      ...emptyOverview,
      incomingFriendRequests: [{ playerId: "pending-1", displayName: "PendingAlice" }],
    };
    mockGetSocialOverview.mockResolvedValue({ overview });

    renderHook(() => useSocialNotifications(), { wrapper });

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: "friend-request:pending-1",
          description: "sent you a friend request",
        }),
      );
    });
  });

  it("does not re-toast friend requests on page refresh (IDs in sessionStorage)", async () => {
    // Pre-populate sessionStorage with already-toasted IDs
    sessionStorage.setItem(
      "tiao:toasted-notifs:my-player",
      JSON.stringify(["friend-request:alice-id"]),
    );

    const overview: SocialOverview = {
      ...emptyOverview,
      incomingFriendRequests: [{ playerId: "alice-id", displayName: "Alice" }],
    };
    mockGetSocialOverview.mockResolvedValue({ overview });

    renderHook(() => useSocialNotifications(), { wrapper });

    await flushHydration();

    // Toast should NOT have been called for alice since she's already in sessionStorage
    expect(toast).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "friend-request:alice-id" }),
    );
  });

  it("shows toasts for pending game invitations on fresh session", async () => {
    const overview: SocialOverview = {
      ...emptyOverview,
      incomingInvitations: [
        {
          id: "inv-fresh",
          gameId: "game-fresh",
          roomType: "direct",
          createdAt: "2026-01-01T00:00:00Z",
          expiresAt: "2026-01-02T00:00:00Z",
          sender: { playerId: "carol-id", displayName: "Carol" },
          recipient: { playerId: "my-player", displayName: "Me" },
        },
      ],
    };
    mockGetSocialOverview.mockResolvedValue({ overview });

    renderHook(() => useSocialNotifications(), { wrapper });

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: "game-invitation:inv-fresh",
        }),
      );
    });
  });

  it("tracks incomingRematchCount from game-update messages", async () => {
    mockGetSocialOverview.mockResolvedValue({ overview: emptyOverview });

    const { result } = renderHook(() => useSocialNotifications(), { wrapper });

    await flushHydration();

    // Simulate a game-update with an incoming rematch
    simulateLobbyMessage({
      type: "game-update",
      summary: {
        gameId: "rematch-game-1",
        status: "finished",
        rematch: { requestedBy: ["black"] },
        yourSeat: "white",
        seats: {
          white: { player: { displayName: "Me" } },
          black: { player: { displayName: "Opponent" } },
        },
      },
    });

    expect(result.current.incomingRematchCount).toBe(1);
  });

  it("removes from rematch count when rematch is cancelled", async () => {
    mockGetSocialOverview.mockResolvedValue({ overview: emptyOverview });

    const { result } = renderHook(() => useSocialNotifications(), { wrapper });

    await flushHydration();

    // Incoming rematch
    simulateLobbyMessage({
      type: "game-update",
      summary: {
        gameId: "rematch-game-2",
        status: "finished",
        rematch: { requestedBy: ["black"] },
        yourSeat: "white",
        seats: {
          white: { player: { displayName: "Me" } },
          black: { player: { displayName: "Opponent" } },
        },
      },
    });

    expect(result.current.incomingRematchCount).toBe(1);

    // Rematch cancelled
    simulateLobbyMessage({
      type: "game-update",
      summary: {
        gameId: "rematch-game-2",
        status: "finished",
        rematch: null,
        yourSeat: "white",
        seats: {
          white: { player: { displayName: "Me" } },
          black: { player: { displayName: "Opponent" } },
        },
      },
    });

    expect(result.current.incomingRematchCount).toBe(0);
  });

  it("clearRematchNotification drops the gameId from incomingRematchCount immediately", async () => {
    // Accepting a rematch from the game page sends a socket message but the
    // server may not re-broadcast the old game's finished snapshot, so the
    // lobby bubble would stay lit. clearRematchNotification gives callers a
    // way to drop a single rematch from the client state without waiting.
    mockGetSocialOverview.mockResolvedValue({ overview: emptyOverview });

    const { result } = renderHook(() => useSocialNotifications(), { wrapper });

    await flushHydration();

    simulateLobbyMessage({
      type: "game-update",
      summary: {
        gameId: "rematch-accept-1",
        status: "finished",
        rematch: { requestedBy: ["black"] },
        yourSeat: "white",
        seats: {
          white: { player: { displayName: "Me" } },
          black: { player: { displayName: "Opponent" } },
        },
      },
    });

    expect(result.current.incomingRematchCount).toBe(1);
    expect(result.current.unacknowledgedRematchCount).toBe(1);

    act(() => {
      result.current.clearRematchNotification("rematch-accept-1");
    });

    expect(result.current.incomingRematchCount).toBe(0);
    expect(result.current.unacknowledgedRematchCount).toBe(0);
  });

  it("clearFriendRequestNotification drops the request from unacknowledgedFriendRequestCount", async () => {
    // Accepting a friend request anywhere (lobby button, in-game toast)
    // should clear the bubble immediately. The underlying overview list
    // still contains the entry until the server confirms and broadcasts,
    // but we want the badge count to drop right away.
    const overviewWithRequest: SocialOverview = {
      friends: [],
      incomingFriendRequests: [{ playerId: "friend-1", displayName: "Friend One" } as never],
      outgoingFriendRequests: [],
      incomingInvitations: [],
      outgoingInvitations: [],
    };
    mockGetSocialOverview.mockResolvedValue({ overview: overviewWithRequest });

    const { result } = renderHook(() => useSocialNotifications(), { wrapper });

    await waitFor(() => {
      expect(result.current.unacknowledgedFriendRequestCount).toBe(1);
    });

    act(() => {
      result.current.clearFriendRequestNotification("friend-1");
    });

    expect(result.current.unacknowledgedFriendRequestCount).toBe(0);
    // The overview itself still has the entry — only the unack count drops.
    expect(result.current.pendingFriendRequestCount).toBe(1);
  });

  it("does not count outgoing rematch requests in incomingRematchCount", async () => {
    mockGetSocialOverview.mockResolvedValue({ overview: emptyOverview });

    const { result } = renderHook(() => useSocialNotifications(), { wrapper });

    await flushHydration();

    // Outgoing rematch (YOU requested)
    simulateLobbyMessage({
      type: "game-update",
      summary: {
        gameId: "rematch-game-3",
        status: "finished",
        rematch: { requestedBy: ["white"] },
        yourSeat: "white",
        seats: {
          white: { player: { displayName: "Me" } },
          black: { player: { displayName: "Opponent" } },
        },
      },
    });

    expect(result.current.incomingRematchCount).toBe(0);
  });

  it("populates sessionStorage with toasted notification IDs", async () => {
    const overview: SocialOverview = {
      ...emptyOverview,
      incomingFriendRequests: [{ playerId: "req-1", displayName: "Alice" }],
    };
    mockGetSocialOverview.mockResolvedValue({ overview });

    renderHook(() => useSocialNotifications(), { wrapper });

    await flushHydration();

    // Verify sessionStorage was set with toasted IDs
    const stored = sessionStorage.getItem("tiao:toasted-notifs:my-player");
    expect(stored).not.toBeNull();
    const ids = JSON.parse(stored!) as string[];
    expect(ids).toContain("friend-request:req-1");
  });

  it("counts unacknowledged friend requests separately from total", async () => {
    const overview: SocialOverview = {
      ...emptyOverview,
      incomingFriendRequests: [
        { playerId: "alice-id", displayName: "Alice" },
        { playerId: "bob-id", displayName: "Bob" },
      ],
    };
    mockGetSocialOverview.mockResolvedValue({ overview });

    const { result } = renderHook(() => useSocialNotifications(), { wrapper });

    await waitFor(() => {
      expect(result.current.pendingFriendRequestCount).toBe(2);
      expect(result.current.unacknowledgedFriendRequestCount).toBe(2);
    });
  });

  it("acknowledgeFriendRequests clears unacknowledged count without removing items", async () => {
    const overview: SocialOverview = {
      ...emptyOverview,
      incomingFriendRequests: [
        { playerId: "alice-id", displayName: "Alice" },
        { playerId: "bob-id", displayName: "Bob" },
      ],
    };
    mockGetSocialOverview.mockResolvedValue({ overview });

    const { result } = renderHook(() => useSocialNotifications(), { wrapper });

    await waitFor(() => {
      expect(result.current.unacknowledgedFriendRequestCount).toBe(2);
    });

    act(() => {
      result.current.acknowledgeFriendRequests();
    });

    expect(result.current.unacknowledgedFriendRequestCount).toBe(0);
    // The total still reflects the items themselves — only the badge clears.
    expect(result.current.pendingFriendRequestCount).toBe(2);
  });

  it("persists acknowledged friend request IDs to sessionStorage", async () => {
    const overview: SocialOverview = {
      ...emptyOverview,
      incomingFriendRequests: [{ playerId: "alice-id", displayName: "Alice" }],
    };
    mockGetSocialOverview.mockResolvedValue({ overview });

    const { result } = renderHook(() => useSocialNotifications(), { wrapper });

    await waitFor(() => {
      expect(result.current.unacknowledgedFriendRequestCount).toBe(1);
    });

    act(() => {
      result.current.acknowledgeFriendRequests();
    });

    const stored = sessionStorage.getItem("tiao:acked-notifs:my-player");
    expect(stored).not.toBeNull();
    const ids = JSON.parse(stored!) as string[];
    expect(ids).toContain("friend-request:alice-id");
  });

  it("re-shows badge when a new friend request arrives after ack", async () => {
    const initialOverview: SocialOverview = {
      ...emptyOverview,
      incomingFriendRequests: [{ playerId: "alice-id", displayName: "Alice" }],
    };
    mockGetSocialOverview.mockResolvedValue({ overview: initialOverview });

    const { result } = renderHook(() => useSocialNotifications(), { wrapper });

    await waitFor(() => {
      expect(result.current.unacknowledgedFriendRequestCount).toBe(1);
    });

    act(() => {
      result.current.acknowledgeFriendRequests();
    });
    expect(result.current.unacknowledgedFriendRequestCount).toBe(0);

    // A new request arrives via socket — should bump the unack count even
    // though Alice's request is still in the acknowledged set.
    simulateLobbyMessage({
      type: "social-update",
      overview: {
        ...emptyOverview,
        incomingFriendRequests: [
          { playerId: "alice-id", displayName: "Alice" },
          { playerId: "carol-id", displayName: "Carol" },
        ],
      },
    });

    await waitFor(() => {
      expect(result.current.unacknowledgedFriendRequestCount).toBe(1);
    });
  });

  it("prunes acknowledged friend request IDs when the request disappears", async () => {
    sessionStorage.setItem(
      "tiao:acked-notifs:my-player",
      JSON.stringify(["friend-request:alice-id"]),
    );
    const initialOverview: SocialOverview = {
      ...emptyOverview,
      incomingFriendRequests: [{ playerId: "alice-id", displayName: "Alice" }],
    };
    mockGetSocialOverview.mockResolvedValue({ overview: initialOverview });

    const { result } = renderHook(() => useSocialNotifications(), { wrapper });

    await waitFor(() => {
      expect(result.current.unacknowledgedFriendRequestCount).toBe(0);
    });

    // Alice accepts/declines elsewhere — the request disappears. The
    // acknowledged ID should be pruned so a future request from Alice will
    // count again.
    simulateLobbyMessage({ type: "social-update", overview: emptyOverview });

    await waitFor(() => {
      const stored = sessionStorage.getItem("tiao:acked-notifs:my-player");
      const ids = stored ? (JSON.parse(stored) as string[]) : [];
      expect(ids).not.toContain("friend-request:alice-id");
    });
  });

  it("includes game config details in invitation toast", async () => {
    mockGetSocialOverview.mockResolvedValue({ overview: emptyOverview });

    renderHook(() => useSocialNotifications(), { wrapper });

    await flushHydration();

    const updatedOverview: SocialOverview = {
      ...emptyOverview,
      incomingInvitations: [
        {
          id: "inv-detail",
          gameId: "game-detail",
          roomType: "direct",
          createdAt: "2026-01-01T00:00:00Z",
          expiresAt: "2026-01-02T00:00:00Z",
          sender: { playerId: "eve-id", displayName: "Eve" },
          recipient: { playerId: "my-player", displayName: "Me" },
          boardSize: 13,
          timeControl: { initialMs: 300_000, incrementMs: 2_000 },
          scoreToWin: 5,
        },
      ],
    };

    simulateLobbyMessage({ type: "social-update", overview: updatedOverview });

    expect(toast).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: "game-invitation:inv-detail",
        description: "invited you to a game (13×13, 5+2, first to 5)",
      }),
    );
  });
});
