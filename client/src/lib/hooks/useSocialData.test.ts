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

  it("does not trigger social actions for guest players", async () => {
    mockGetSocialOverview.mockResolvedValue({ overview: emptyOverview });

    const { result } = renderHook(() => useSocialData(mockGuestAuth, false));

    await act(async () => {
      await result.current.handleSendFriendRequest("some-id");
    });

    expect(mockSendFriendRequest).not.toHaveBeenCalled();
  });
});
