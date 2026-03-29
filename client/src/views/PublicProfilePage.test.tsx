import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { PublicProfilePage } from "./PublicProfilePage";

const mockGetPublicProfile = vi.fn();

vi.mock("@/lib/api", () => ({
  getPublicProfile: (...args: unknown[]) => mockGetPublicProfile(...args),
}));

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({
    auth: null,
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
