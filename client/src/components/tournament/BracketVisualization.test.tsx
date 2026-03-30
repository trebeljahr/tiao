import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BracketVisualization } from "./BracketVisualization";
import type { TournamentRound } from "@shared";

// Mock MatchCard to isolate BracketVisualization tests
vi.mock("./MatchCard", () => ({
  MatchCard: ({ match, featured }: { match: { matchId: string }; featured?: boolean }) => (
    <div data-testid={`match-${match.matchId}`} data-featured={featured}>
      match-{match.matchId}
    </div>
  ),
}));

function makeRound(overrides?: Partial<TournamentRound>): TournamentRound {
  return {
    roundIndex: 0,
    label: "Round 1",
    status: "active",
    matches: [
      {
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
      },
    ],
    ...overrides,
  };
}

describe("BracketVisualization", () => {
  it("renders empty state when no rounds", () => {
    render(<BracketVisualization rounds={[]} />);
    expect(screen.getByText("No bracket data available yet.")).toBeInTheDocument();
  });

  it("renders round labels", () => {
    const rounds = [makeRound({ label: "Quarterfinals" })];
    render(<BracketVisualization rounds={rounds} />);
    expect(screen.getByText("Quarterfinals")).toBeInTheDocument();
  });

  it("renders a MatchCard for each match", () => {
    const rounds = [
      makeRound({
        matches: [
          {
            matchId: "m1",
            roundIndex: 0,
            matchIndex: 0,
            players: [null, null],
            roomId: null,
            winner: null,
            score: [0, 0],
            status: "pending",
          },
          {
            matchId: "m2",
            roundIndex: 0,
            matchIndex: 1,
            players: [null, null],
            roomId: null,
            winner: null,
            score: [0, 0],
            status: "pending",
          },
        ],
      }),
    ];
    render(<BracketVisualization rounds={rounds} />);
    expect(screen.getByTestId("match-m1")).toBeInTheDocument();
    expect(screen.getByTestId("match-m2")).toBeInTheDocument();
  });

  it("renders multiple rounds side by side", () => {
    const rounds = [
      makeRound({ roundIndex: 0, label: "Semifinals" }),
      makeRound({ roundIndex: 1, label: "Final", matches: [] }),
    ];
    render(<BracketVisualization rounds={rounds} />);
    expect(screen.getByText("Semifinals")).toBeInTheDocument();
    expect(screen.getByText("Final")).toBeInTheDocument();
  });

  it("passes featuredMatchId to MatchCard", () => {
    const rounds = [makeRound()];
    render(<BracketVisualization rounds={rounds} featuredMatchId="m1" />);
    const card = screen.getByTestId("match-m1");
    expect(card).toHaveAttribute("data-featured", "true");
  });

  it("does not mark non-featured matches as featured", () => {
    const rounds = [makeRound()];
    render(<BracketVisualization rounds={rounds} featuredMatchId="m99" />);
    const card = screen.getByTestId("match-m1");
    expect(card).toHaveAttribute("data-featured", "false");
  });
});
