import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@/test/navigation-mock";
import { Providers } from "../app/providers";

vi.mock("@/lib/api", () => ({
  createGuest: vi.fn().mockResolvedValue({
    player: { playerId: "guest-123", displayName: "brave-pink-fox", kind: "guest" },
  }),
  getCurrentPlayer: vi.fn().mockRejectedValue(new Error("Not logged in")),
  buildWebSocketUrl: vi.fn().mockReturnValue("ws://localhost:5005/api/ws"),
}));

vi.mock("@/lib/SocialNotificationsContext", () => ({
  SocialNotificationsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSocialNotifications: () => ({
    pendingFriendRequestCount: 0,
    incomingInvitationCount: 0,
    refreshNotifications: vi.fn(),
  }),
}));

vi.mock("@/lib/LobbySocketContext", () => ({
  LobbySocketProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useLobbyMessage: vi.fn(),
}));

describe("Providers", () => {
  it("renders loading screen while auth is bootstrapping", async () => {
    render(<Providers><div>child content</div></Providers>);
    expect(screen.getByText(/Opening Tiao/i)).toBeInTheDocument();
    // Wait for the async guest auth to settle so React doesn't warn about act()
    await waitFor(() => {
      expect(screen.queryByText(/Opening Tiao/i)).not.toBeInTheDocument();
    });
  });
});
