import type { TournamentRound } from "@shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BracketVisualization } from "./BracketVisualization";

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

  it("renders round labels computed from position-from-end", () => {
    // Component derives labels client-side from each round's index
    // relative to the last round, so a 3-round bracket shows
    // "Quarterfinals", "Semifinals", "Final" regardless of any label
    // the server provided. The round.label field is effectively unused.
    const rounds = [
      makeRound({ roundIndex: 0, matches: [] }),
      makeRound({ roundIndex: 1, matches: [] }),
      makeRound({ roundIndex: 2, matches: [] }),
    ];
    render(<BracketVisualization rounds={rounds} />);
    expect(screen.getByText("Quarterfinals")).toBeInTheDocument();
    expect(screen.getByText("Semifinals")).toBeInTheDocument();
    expect(screen.getByText("Final")).toBeInTheDocument();
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
