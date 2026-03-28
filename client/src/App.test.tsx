import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@/test/navigation-mock";
import { Providers } from "../app/[locale]/providers";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    createGuest: vi.fn().mockResolvedValue({
      player: { playerId: "guest-123", displayName: "brave-pink-fox", kind: "guest" },
    }),
    getCurrentPlayer: vi.fn().mockRejectedValue(new Error("Not logged in")),
    buildWebSocketUrl: vi.fn().mockReturnValue("ws://localhost:5005/api/ws"),
  };
});

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
  it("renders children after auth bootstrap", async () => {
    render(
      <Providers>
        <div>child content</div>
      </Providers>,
    );
    await waitFor(() => {
      expect(screen.getByText("child content")).toBeInTheDocument();
    });
  });
});
