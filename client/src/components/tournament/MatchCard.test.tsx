import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MatchCard } from "./MatchCard";
import type { TournamentMatch } from "@shared";

// Mock PlayerIdentityRow
vi.mock("@/components/PlayerIdentityRow", () => ({
  PlayerIdentityRow: ({ player }: { player: { displayName?: string } }) => (
    <span data-testid="player-identity">{player.displayName}</span>
  ),
}));

// Mock GameShared — formatFinishReason
vi.mock("@/components/game/GameShared", () => ({
  formatFinishReason: (reason: string | null) => {
    if (reason === "forfeit") return "Forfeit";
    if (reason === "timeout") return "Time ran out";
    if (reason === "captured") return "Score reached";
    return "";
  },
}));

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    back: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
  notFound: vi.fn(),
  useSelectedLayoutSegment: () => null,
  useSelectedLayoutSegments: () => [],
}));

function makeMatch(overrides?: Partial<TournamentMatch>): TournamentMatch {
  return {
    matchId: "m1",
    roundIndex: 0,
    matchIndex: 0,
    players: [
      { playerId: "p1", displayName: "Alice", seed: 1 },
      { playerId: "p2", displayName: "Bob", seed: 2 },
    ],
    roomId: null,
    winner: null,
    score: [0, 0],
    status: "pending",
    ...overrides,
  };
}

describe("MatchCard", () => {
  beforeEach(() => {
    mockPush.mockReset();
  });

  it("renders without crashing with minimal props", () => {
    render(<MatchCard match={makeMatch()} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("shows Upcoming badge for pending status", () => {
    render(<MatchCard match={makeMatch({ status: "pending" })} />);
    expect(screen.getByText("Upcoming")).toBeInTheDocument();
  });

  it("shows Live badge for active status", () => {
    render(<MatchCard match={makeMatch({ status: "active" })} />);
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("shows Bye badge for bye status", () => {
    render(<MatchCard match={makeMatch({ status: "bye" })} />);
    expect(screen.getByText("Bye")).toBeInTheDocument();
  });

  it("shows finish reason for finished match", () => {
    render(
      <MatchCard
        match={makeMatch({
          status: "finished",
          winner: "p1",
          finishReason: "timeout",
        })}
      />,
    );
    expect(screen.getByText("Time ran out")).toBeInTheDocument();
  });

  it("shows move count for finished match with historyLength", () => {
    render(
      <MatchCard
        match={makeMatch({
          status: "finished",
          winner: "p1",
          historyLength: 42,
        })}
      />,
    );
    expect(screen.getByText("42 moves")).toBeInTheDocument();
  });

  it("shows TBD for null players", () => {
    render(<MatchCard match={makeMatch({ players: [null, null] })} />);
    const tbds = screen.getAllByText("TBD");
    expect(tbds).toHaveLength(2);
  });

  it("shows Won badge next to winner", () => {
    render(
      <MatchCard
        match={makeMatch({
          status: "finished",
          winner: "p1",
        })}
      />,
    );
    expect(screen.getByText("Won")).toBeInTheDocument();
  });

  it("shows scores for active matches", () => {
    render(
      <MatchCard
        match={makeMatch({
          status: "active",
          score: [3, 5],
          roomId: "room1",
        })}
      />,
    );
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("does not show scores for pending matches", () => {
    const { container } = render(
      <MatchCard match={makeMatch({ status: "pending", score: [3, 5] })} />,
    );
    // Scores should not appear for pending
    expect(container.textContent).not.toContain("3");
    // seed #1 and #2 are present, but score 5 should not be
    expect(screen.queryByText("5")).not.toBeInTheDocument();
  });

  it("shows Play button for own active match", async () => {
    render(
      <MatchCard match={makeMatch({ status: "active", roomId: "room1" })} currentPlayerId="p1" />,
    );
    expect(screen.getByText("Play")).toBeInTheDocument();
  });

  it("shows Watch button for others' active match", () => {
    render(
      <MatchCard match={makeMatch({ status: "active", roomId: "room1" })} currentPlayerId="p99" />,
    );
    expect(screen.getByText("Watch")).toBeInTheDocument();
  });

  it("shows Review button for finished match", () => {
    render(<MatchCard match={makeMatch({ status: "finished", roomId: "room1", winner: "p1" })} />);
    expect(screen.getByText("Review")).toBeInTheDocument();
  });

  it("navigates to game room on Play click", () => {
    render(
      <MatchCard match={makeMatch({ status: "active", roomId: "room1" })} currentPlayerId="p1" />,
    );
    fireEvent.click(screen.getByText("Play"));
    expect(mockPush).toHaveBeenCalledWith("/game/room1");
  });

  it("navigates to game room on Review click", () => {
    render(<MatchCard match={makeMatch({ status: "finished", roomId: "room1", winner: "p1" })} />);
    fireEvent.click(screen.getByText("Review"));
    expect(mockPush).toHaveBeenCalledWith("/game/room1");
  });

  it("applies featured styling when featured prop is true", () => {
    const { container } = render(<MatchCard match={makeMatch()} featured={true} />);
    const card = container.firstElementChild;
    expect(card?.className).toContain("border-amber-400");
  });

  it("renders color dots when playerColors are set", () => {
    const { container } = render(
      <MatchCard match={makeMatch({ playerColors: ["white", "black"] })} />,
    );
    const dots = container.querySelectorAll("span.rounded-full");
    expect(dots.length).toBe(2);
  });

  it("does not show action buttons when roomId is null", () => {
    render(
      <MatchCard match={makeMatch({ status: "active", roomId: null })} currentPlayerId="p1" />,
    );
    expect(screen.queryByText("Play")).not.toBeInTheDocument();
    expect(screen.queryByText("Watch")).not.toBeInTheDocument();
  });
});
