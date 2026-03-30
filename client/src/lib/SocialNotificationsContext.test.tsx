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
  };
  toastFn.dismiss = vi.fn();
  toastFn.success = vi.fn();
  return { toast: toastFn };
});

// Capture the useLobbyMessage handler so we can simulate WebSocket messages
let lobbyMessageHandler: ((payload: Record<string, unknown>) => void) | null = null;

vi.mock("./LobbySocketContext", () => ({
  useLobbyMessage: (handler: (payload: Record<string, unknown>) => void) => {
    lobbyMessageHandler = handler;
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
    lobbyMessageHandler?.(payload);
  });
}

// --- Tests ---

describe("SocialNotificationsContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lobbyMessageHandler = null;
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
    await waitFor(() => {
      expect(mockGetSocialOverview).toHaveBeenCalled();
    });

    // Simulate a social-update with a new friend request
    const updatedOverview: SocialOverview = {
      ...emptyOverview,
      incomingFriendRequests: [{ playerId: "alice-id", displayName: "Alice" }],
    };

    simulateLobbyMessage({ type: "social-update", overview: updatedOverview });

    expect(toast).toHaveBeenCalledWith(
      "Alice sent you a friend request",
      expect.objectContaining({
        id: "friend-request:alice-id",
        duration: 15000,
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
    await waitFor(() => {
      expect(mockGetSocialOverview).toHaveBeenCalled();
    });

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

    await waitFor(() => {
      expect(mockGetSocialOverview).toHaveBeenCalled();
    });

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

    await waitFor(() => {
      expect(mockGetSocialOverview).toHaveBeenCalled();
    });

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

    await waitFor(() => {
      expect(mockGetSocialOverview).toHaveBeenCalled();
    });

    // Invitation is gone (declined from another page)
    simulateLobbyMessage({ type: "social-update", overview: emptyOverview });

    expect(toast.dismiss).toHaveBeenCalledWith("game-invitation:inv-1");
  });

  it("does not dismiss toasts when not hydrated yet", async () => {
    // Initial fetch returns empty, so hydration sets prevRequestIds to empty
    mockGetSocialOverview.mockResolvedValue({ overview: emptyOverview });

    renderHook(() => useSocialNotifications(), { wrapper });

    await waitFor(() => {
      expect(mockGetSocialOverview).toHaveBeenCalled();
    });

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
      "Alice sent you a friend request",
      expect.objectContaining({ id: "friend-request:alice-id" }),
    );
  });

  it("assigns stable toast IDs to game invitation toasts", async () => {
    mockGetSocialOverview.mockResolvedValue({ overview: emptyOverview });

    renderHook(() => useSocialNotifications(), { wrapper });

    await waitFor(() => {
      expect(mockGetSocialOverview).toHaveBeenCalled();
    });

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
      "Dave invited you to a game",
      expect.objectContaining({
        id: "game-invitation:inv-99",
      }),
    );
  });
});
