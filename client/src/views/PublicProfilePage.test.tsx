import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PublicProfilePage } from "./PublicProfilePage";

const mockGetPublicProfile = vi.fn();
const mockSendFriendRequest = vi.fn();
const mockAcceptFriendRequest = vi.fn();

vi.mock("@/lib/api", () => ({
  getPublicProfile: (...args: unknown[]) => mockGetPublicProfile(...args),
  getPlayerMatchHistory: vi.fn().mockResolvedValue({ games: [], playerId: null, hasMore: false }),
  getPlayerAchievements: vi.fn().mockResolvedValue({ achievements: [] }),
  sendFriendRequest: (...args: unknown[]) => mockSendFriendRequest(...args),
  acceptFriendRequest: (...args: unknown[]) => mockAcceptFriendRequest(...args),
}));

const mockAuth = {
  player: { playerId: "me-1", displayName: "CurrentUser", kind: "account" as const },
};

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({
    auth: mockAuth,
    authLoading: false,
    onOpenAuth: vi.fn(),
    onLogout: vi.fn(),
  }),
}));

vi.mock("@/lib/SocialNotificationsContext", () => ({
  useSocialNotifications: () => ({
    pendingFriendRequestCount: 0,
    incomingInvitationCount: 0,
    refreshNotifications: vi.fn(),
  }),
}));

const mockSocialOverview = {
  friends: [] as Array<{ playerId: string }>,
  outgoingFriendRequests: [] as Array<{ playerId: string }>,
  incomingFriendRequests: [] as Array<{ playerId: string }>,
  invitations: [],
};
const mockHandleSendFriendRequest = vi.fn();
const mockHandleCancelFriendRequest = vi.fn();
const mockHandleAcceptFriendRequest = vi.fn();
const mockHandleDeclineFriendRequest = vi.fn();
const mockHandleRemoveFriend = vi.fn();
vi.mock("@/lib/hooks/useSocialData", () => ({
  useSocialData: () => ({
    socialOverview: mockSocialOverview,
    refreshSocialOverview: vi.fn(),
    socialActionBusyKey: null,
    handleSendFriendRequest: (...args: unknown[]) => mockHandleSendFriendRequest(...args),
    handleCancelFriendRequest: (...args: unknown[]) => mockHandleCancelFriendRequest(...args),
    handleAcceptFriendRequest: (...args: unknown[]) => mockHandleAcceptFriendRequest(...args),
    handleDeclineFriendRequest: (...args: unknown[]) => mockHandleDeclineFriendRequest(...args),
    handleRemoveFriend: (...args: unknown[]) => mockHandleRemoveFriend(...args),
  }),
}));

vi.mock("@/lib/LobbySocketContext", () => ({
  useLobbyMessage: vi.fn(),
}));

// Override useParams per test
let mockParams: Record<string, string> = {};
vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return {
    ...actual,
    useRouter: () => ({
      push: vi.fn(),
      replace: vi.fn(),
      back: vi.fn(),
      refresh: vi.fn(),
      prefetch: vi.fn(),
    }),
    usePathname: () => "/",
    useSearchParams: () => new URLSearchParams(),
    useParams: () => mockParams,
  };
});

describe("PublicProfilePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPublicProfile.mockResolvedValue({
      profile: { displayName: "Andreas Edmeier", createdAt: "2025-01-01T00:00:00Z" },
    });
  });

  it("decodes URL-encoded username before calling API (no double-encoding)", async () => {
    // Simulate Next.js providing a URL-encoded param (space -> %20)
    mockParams = { username: "Andreas%20Edmeier" };

    render(<PublicProfilePage />);

    await waitFor(() => {
      expect(mockGetPublicProfile).toHaveBeenCalledWith("Andreas Edmeier");
    });
  });

  it("handles already-decoded username params correctly", async () => {
    mockParams = { username: "ricotrebeljahr" };

    render(<PublicProfilePage />);

    await waitFor(() => {
      expect(mockGetPublicProfile).toHaveBeenCalledWith("ricotrebeljahr");
    });
  });

  it("displays the profile after loading", async () => {
    mockParams = { username: "Andreas%20Edmeier" };

    render(<PublicProfilePage />);

    await waitFor(() => {
      expect(screen.getByText("Andreas Edmeier")).toBeInTheDocument();
    });
  });
});

describe("PublicProfilePage add friend (#92)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParams = { username: "SomePlayer" };
    // Reset social overview so profileId isn't in any list → friendRelationship = "none"
    mockSocialOverview.friends = [];
    mockSocialOverview.outgoingFriendRequests = [];
    mockSocialOverview.incomingFriendRequests = [];
  });

  it("renders 'Add Friend' button when friendshipStatus is 'none'", async () => {
    mockGetPublicProfile.mockResolvedValue({
      profile: {
        displayName: "SomePlayer",
        playerId: "player-2",
        createdAt: "2025-01-01T00:00:00Z",
        friendshipStatus: "none",
      },
    });

    render(<PublicProfilePage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /add friend/i })).toBeInTheDocument();
    });
  });

  it("calls handleSendFriendRequest on click", async () => {
    mockGetPublicProfile.mockResolvedValue({
      profile: {
        displayName: "SomePlayer",
        playerId: "player-2",
        createdAt: "2025-01-01T00:00:00Z",
        friendshipStatus: "none",
      },
    });

    render(<PublicProfilePage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /add friend/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /add friend/i }));

    await waitFor(() => {
      expect(mockHandleSendFriendRequest).toHaveBeenCalledWith("player-2");
    });
  });

  it("renders 'Unfriend' button when player is a friend", async () => {
    mockSocialOverview.friends = [{ playerId: "player-2" }];
    mockGetPublicProfile.mockResolvedValue({
      profile: {
        displayName: "SomePlayer",
        playerId: "player-2",
        createdAt: "2025-01-01T00:00:00Z",
      },
    });

    render(<PublicProfilePage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /unfriend/i })).toBeInTheDocument();
    });
  });

  it("renders 'Accept' button when there is an incoming friend request", async () => {
    mockSocialOverview.incomingFriendRequests = [{ playerId: "player-2" }];
    mockGetPublicProfile.mockResolvedValue({
      profile: {
        displayName: "SomePlayer",
        playerId: "player-2",
        createdAt: "2025-01-01T00:00:00Z",
      },
    });

    render(<PublicProfilePage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /accept/i })).toBeInTheDocument();
    });
  });

  it("does not render friend buttons when viewing own profile", async () => {
    mockGetPublicProfile.mockResolvedValue({
      profile: {
        displayName: "MyUser",
        playerId: "me-1",
        createdAt: "2025-01-01T00:00:00Z",
      },
    });

    render(<PublicProfilePage />);

    await waitFor(() => {
      expect(screen.getByText("MyUser")).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: /add friend/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /unfriend/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /accept/i })).not.toBeInTheDocument();
  });
});
