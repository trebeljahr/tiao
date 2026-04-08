import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSocialData } from "./useSocialData";
import type { AuthResponse, SocialOverview } from "@shared";

const mockGetSocialOverview = vi.fn();
const mockSearchPlayers = vi.fn();
const mockSendFriendRequest = vi.fn();
const mockAcceptFriendRequest = vi.fn();
const mockDeclineFriendRequest = vi.fn();
const mockCancelFriendRequest = vi.fn();
const mockSendGameInvitation = vi.fn();
const mockRevokeGameInvitation = vi.fn();

vi.mock("../api", () => ({
  getSocialOverview: (...args: unknown[]) => mockGetSocialOverview(...args),
  searchPlayers: (...args: unknown[]) => mockSearchPlayers(...args),
  sendFriendRequest: (...args: unknown[]) => mockSendFriendRequest(...args),
  acceptFriendRequest: (...args: unknown[]) => mockAcceptFriendRequest(...args),
  declineFriendRequest: (...args: unknown[]) => mockDeclineFriendRequest(...args),
  cancelFriendRequest: (...args: unknown[]) => mockCancelFriendRequest(...args),
  sendGameInvitation: (...args: unknown[]) => mockSendGameInvitation(...args),
  revokeGameInvitation: (...args: unknown[]) => mockRevokeGameInvitation(...args),
}));

vi.mock("../errors", () => ({
  toastError: vi.fn(),
}));

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

const mockAuth: AuthResponse = {
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

const emptyOverview: SocialOverview = {
  friends: [],
  incomingFriendRequests: [],
  outgoingFriendRequests: [],
  incomingInvitations: [],
  outgoingInvitations: [],
};

describe("useSocialData", () => {
  beforeEach(() => {
    mockGetSocialOverview.mockReset();
    mockSearchPlayers.mockReset();
    mockSendFriendRequest.mockReset();
    mockAcceptFriendRequest.mockReset();
    mockDeclineFriendRequest.mockReset();
    mockCancelFriendRequest.mockReset();
    mockSendGameInvitation.mockReset();
    mockRevokeGameInvitation.mockReset();
    lobbyMessageHandlers.length = 0;
  });

  it("initializes with empty social overview", () => {
    mockGetSocialOverview.mockResolvedValue({ overview: emptyOverview });
    const { result } = renderHook(() => useSocialData(null, false));
    expect(result.current.socialOverview.friends).toEqual([]);
    expect(result.current.socialLoaded).toBe(false);
  });

  it("does not fetch when auth is null", async () => {
    renderHook(() => useSocialData(null, false));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockGetSocialOverview).not.toHaveBeenCalled();
  });

  it("does not fetch for guest players", async () => {
    mockGetSocialOverview.mockResolvedValue({ overview: emptyOverview });
    renderHook(() => useSocialData(mockGuestAuth, false));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockGetSocialOverview).not.toHaveBeenCalled();
  });

  it("fetches social overview for account players", async () => {
    const overview: SocialOverview = {
      ...emptyOverview,
      friends: [{ playerId: "friend-1", displayName: "Friend" }],
    };
    mockGetSocialOverview.mockResolvedValue({ overview });

    const { result } = renderHook(() => useSocialData(mockAuth, false));

    await waitFor(() => {
      expect(result.current.socialLoaded).toBe(true);
    });

    expect(result.current.socialOverview.friends).toHaveLength(1);
    expect(result.current.socialOverview.friends[0].displayName).toBe("Friend");
  });

  it("sends friend request and refreshes overview", async () => {
    mockGetSocialOverview.mockResolvedValue({ overview: emptyOverview });
    mockSendFriendRequest.mockResolvedValue({ message: "Sent" });
    mockSearchPlayers.mockResolvedValue({ results: [] });

    const { result } = renderHook(() => useSocialData(mockAuth, false));

    await waitFor(() => {
      expect(result.current.socialLoaded).toBe(true);
    });

    await act(async () => {
      await result.current.handleSendFriendRequest("friend-id");
    });

    expect(mockSendFriendRequest).toHaveBeenCalledWith("friend-id");
    // Should have refreshed overview after sending
    expect(mockGetSocialOverview).toHaveBeenCalledTimes(2);
  });

  it("accepts friend request and refreshes overview", async () => {
    mockGetSocialOverview.mockResolvedValue({ overview: emptyOverview });
    mockAcceptFriendRequest.mockResolvedValue({ message: "Accepted" });
    mockSearchPlayers.mockResolvedValue({ results: [] });

    const { result } = renderHook(() => useSocialData(mockAuth, false));

    await waitFor(() => {
      expect(result.current.socialLoaded).toBe(true);
    });

    await act(async () => {
      await result.current.handleAcceptFriendRequest("requester-id");
    });

    expect(mockAcceptFriendRequest).toHaveBeenCalledWith("requester-id");
  });

  it("declines friend request and refreshes overview", async () => {
    mockGetSocialOverview.mockResolvedValue({ overview: emptyOverview });
    mockDeclineFriendRequest.mockResolvedValue({ message: "Declined" });
    mockSearchPlayers.mockResolvedValue({ results: [] });

    const { result } = renderHook(() => useSocialData(mockAuth, false));

    await waitFor(() => {
      expect(result.current.socialLoaded).toBe(true);
    });

    await act(async () => {
      await result.current.handleDeclineFriendRequest("requester-id");
    });

    expect(mockDeclineFriendRequest).toHaveBeenCalledWith("requester-id");
  });

  it("cancels outgoing friend request and refreshes overview", async () => {
    mockGetSocialOverview.mockResolvedValue({ overview: emptyOverview });
    mockCancelFriendRequest.mockResolvedValue({ message: "Cancelled" });
    mockSearchPlayers.mockResolvedValue({ results: [] });

    const { result } = renderHook(() => useSocialData(mockAuth, false));

    await waitFor(() => {
      expect(result.current.socialLoaded).toBe(true);
    });

    await act(async () => {
      await result.current.handleCancelFriendRequest("target-id");
    });

    expect(mockCancelFriendRequest).toHaveBeenCalledWith("target-id");
  });

  it("friend search requires non-empty query", async () => {
    mockGetSocialOverview.mockResolvedValue({ overview: emptyOverview });

    const { result } = renderHook(() => useSocialData(mockAuth, false));

    await waitFor(() => {
      expect(result.current.socialLoaded).toBe(true);
    });

    // Empty query should not call API
    await act(async () => {
      await result.current.runFriendSearch();
    });

    expect(mockSearchPlayers).not.toHaveBeenCalled();
  });

  it("runs friend search with query", async () => {
    mockGetSocialOverview.mockResolvedValue({ overview: emptyOverview });
    mockSearchPlayers.mockResolvedValue({
      results: [
        {
          player: { playerId: "found-1", displayName: "Found User" },
          relationship: "none",
        },
      ],
    });

    const { result } = renderHook(() => useSocialData(mockAuth, false));

    await waitFor(() => {
      expect(result.current.socialLoaded).toBe(true);
    });

    // Set the search query
    act(() => {
      result.current.setFriendSearchQuery("Found");
    });

    await act(async () => {
      await result.current.runFriendSearch();
    });

    expect(mockSearchPlayers).toHaveBeenCalledWith("Found");
    expect(result.current.friendSearchResults).toHaveLength(1);
    expect(result.current.friendSearchResults[0].player.displayName).toBe("Found User");
  });

  it("resets social state when auth becomes null", async () => {
    mockGetSocialOverview.mockResolvedValue({
      overview: {
        ...emptyOverview,
        friends: [{ playerId: "f1", displayName: "Friend" }],
      },
    });

    const { result, rerender } = renderHook(({ auth }) => useSocialData(auth, false), {
      initialProps: { auth: mockAuth as AuthResponse | null },
    });

    await waitFor(() => {
      expect(result.current.socialLoaded).toBe(true);
    });

    rerender({ auth: null });

    await act(async () => {
      await result.current.refreshSocialOverview();
    });

    expect(result.current.socialOverview.friends).toEqual([]);
    expect(result.current.socialLoaded).toBe(false);
  });

  it("retries up to 3 times then stops on persistent error", async () => {
    mockGetSocialOverview.mockRejectedValue(new Error("502 Bad Gateway"));

    const { result } = renderHook(() => useSocialData(mockAuth, false));

    // Wait for all retries to complete (1 initial + 3 retries = 4 calls)
    await waitFor(
      () => {
        expect(result.current.socialLoaded).toBe(true);
      },
      { timeout: 15000 },
    );

    // Should have been called 4 times total (1 + 3 retries), not infinitely
    expect(mockGetSocialOverview).toHaveBeenCalledTimes(4);

    // Wait extra time to confirm no additional calls are made
    await new Promise((r) => setTimeout(r, 200));
    expect(mockGetSocialOverview).toHaveBeenCalledTimes(4);
  });

  it("patches a player-identity-update into the cached friends list", async () => {
    const overview: SocialOverview = {
      ...emptyOverview,
      friends: [
        {
          playerId: "friend-1",
          displayName: "Alice",
          activeBadges: [],
        },
        {
          playerId: "friend-2",
          displayName: "Bob",
          activeBadges: ["supporter"],
        },
      ],
    };
    mockGetSocialOverview.mockResolvedValue({ overview });

    const { result } = renderHook(() => useSocialData(mockAuth, false));

    await waitFor(() => {
      expect(result.current.socialLoaded).toBe(true);
    });

    // Alice equips a new badge in the shop — server broadcasts update
    simulateLobbyMessage({
      type: "player-identity-update",
      playerId: "friend-1",
      activeBadges: ["super-supporter"],
    });

    expect(result.current.socialOverview.friends[0].activeBadges).toEqual(["super-supporter"]);
    // Bob is untouched
    expect(result.current.socialOverview.friends[1].activeBadges).toEqual(["supporter"]);
    // No extra API fetch was needed — the cache was patched in place
    expect(mockGetSocialOverview).toHaveBeenCalledTimes(1);
  });

  it("leaves the overview unchanged when the update targets a non-friend", async () => {
    const overview: SocialOverview = {
      ...emptyOverview,
      friends: [{ playerId: "friend-1", displayName: "Alice", activeBadges: [] }],
    };
    mockGetSocialOverview.mockResolvedValue({ overview });

    const { result } = renderHook(() => useSocialData(mockAuth, false));
    await waitFor(() => expect(result.current.socialLoaded).toBe(true));

    const before = result.current.socialOverview;
    simulateLobbyMessage({
      type: "player-identity-update",
      playerId: "random-stranger",
      activeBadges: ["supporter"],
    });

    // Reference equality: nothing was touched
    expect(result.current.socialOverview).toBe(before);
  });

  it("does not trigger social actions for guest players", async () => {
    mockGetSocialOverview.mockResolvedValue({ overview: emptyOverview });

    const { result } = renderHook(() => useSocialData(mockGuestAuth, false));

    await act(async () => {
      await result.current.handleSendFriendRequest("some-id");
    });

    expect(mockSendFriendRequest).not.toHaveBeenCalled();
  });
});
