import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlayerIdentityRow } from "./PlayerIdentityRow";

// Mock GameShared to simplify avatar rendering
vi.mock("@/components/game/GameShared", () => ({
  PlayerOverviewAvatar: ({ player }: { player: { displayName?: string } }) => (
    <span data-testid="avatar">{player.displayName?.charAt(0)}</span>
  ),
  ConnectionDot: ({ online }: { online: boolean }) => (
    <span data-testid="connection-dot">{online ? "online" : "offline"}</span>
  ),
}));

// Mock UserBadge
vi.mock("@/components/UserBadge", () => ({
  UserBadge: ({ badge }: { badge: string }) => <span data-testid="user-badge">{badge}</span>,
}));

// Mock featureGate
vi.mock("@/lib/featureGate", () => ({
  resolvePlayerBadges: (player: { activeBadges?: string[] }) => player?.activeBadges ?? [],
  isDevFeatureEnabled: () => false,
}));

describe("PlayerIdentityRow (#94)", () => {
  it("wraps content in a Link when linkToProfile is true and displayName is set", () => {
    render(
      <PlayerIdentityRow player={{ playerId: "p1", displayName: "alice" }} linkToProfile={true} />,
    );

    const link = screen.getByRole("link");
    expect(link).toBeInTheDocument();
  });

  it("sets the Link href to /profile/{encodedDisplayName}", () => {
    render(
      <PlayerIdentityRow
        player={{ playerId: "p1", displayName: "alice bob" }}
        linkToProfile={true}
      />,
    );

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/profile/alice%20bob");
  });

  it("does not render a Link when linkToProfile is false", () => {
    render(
      <PlayerIdentityRow player={{ playerId: "p1", displayName: "alice" }} linkToProfile={false} />,
    );

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("does not render a Link when player is anonymous", () => {
    render(
      <PlayerIdentityRow
        player={{ playerId: "p1", displayName: "alice" }}
        anonymous={true}
        linkToProfile={true}
      />,
    );

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("does not render a Link when displayName is undefined", () => {
    render(<PlayerIdentityRow player={{ playerId: "p1" }} linkToProfile={true} />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("places the online indicator on the same row as the player name (next to it)", () => {
    render(
      <PlayerIdentityRow
        player={{ playerId: "p1", displayName: "alice", activeBadges: ["early-adopter"] }}
        linkToProfile={true}
        online={true}
      />,
    );

    const dot = screen.getByTestId("connection-dot");
    const link = screen.getByRole("link");
    // The dot must share an immediate parent with the name link (the name row),
    // not sit at the outer row alongside the badges container.
    expect(dot.parentElement).toBe(link.parentElement);
  });

  it("renders badges separately from the profile link", () => {
    render(
      <PlayerIdentityRow
        player={{ playerId: "p1", displayName: "alice", activeBadges: ["early-adopter"] }}
        linkToProfile={true}
      />,
    );

    const link = screen.getByRole("link");
    const badge = screen.getByTestId("user-badge");

    // Badge is rendered outside the profile link (in its own container)
    expect(link.contains(badge)).toBe(false);
    expect(badge).toBeInTheDocument();
  });
});
