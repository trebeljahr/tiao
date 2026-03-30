import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { StandingsTable } from "./StandingsTable";
import type { TournamentGroupStanding } from "@shared";

// Mock PlayerIdentityRow
vi.mock("@/components/PlayerIdentityRow", () => ({
  PlayerIdentityRow: ({ player }: { player: { displayName?: string } }) => (
    <span data-testid="player-identity">{player.displayName}</span>
  ),
}));

function makeStanding(overrides?: Partial<TournamentGroupStanding>): TournamentGroupStanding {
  return {
    playerId: "p1",
    displayName: "Alice",
    seed: 1,
    wins: 3,
    losses: 1,
    draws: 0,
    points: 6,
    scoreDiff: 5,
    ...overrides,
  };
}

describe("StandingsTable", () => {
  it("renders without crashing with empty standings", () => {
    render(<StandingsTable standings={[]} />);
    // Header row should still exist
    expect(screen.getByText("#")).toBeInTheDocument();
    expect(screen.getByText("Player")).toBeInTheDocument();
  });

  it("renders all column headers", () => {
    render(<StandingsTable standings={[]} />);
    expect(screen.getByText("#")).toBeInTheDocument();
    expect(screen.getByText("Player")).toBeInTheDocument();
    expect(screen.getByText("W")).toBeInTheDocument();
    expect(screen.getByText("L")).toBeInTheDocument();
    expect(screen.getByText("D")).toBeInTheDocument();
    expect(screen.getByText("Pts")).toBeInTheDocument();
    expect(screen.getByText("+/-")).toBeInTheDocument();
  });

  it("renders player rows with correct stats", () => {
    const standings = [
      makeStanding({
        playerId: "p1",
        displayName: "Alice",
        wins: 3,
        losses: 1,
        draws: 0,
        points: 6,
        scoreDiff: 5,
      }),
      makeStanding({
        playerId: "p2",
        displayName: "Bob",
        wins: 2,
        losses: 2,
        draws: 0,
        points: 4,
        scoreDiff: -2,
      }),
    ];
    render(<StandingsTable standings={standings} />);

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("displays rank numbers starting from 1", () => {
    const standings = [
      makeStanding({ playerId: "p1", displayName: "Alice" }),
      makeStanding({ playerId: "p2", displayName: "Bob" }),
      makeStanding({ playerId: "p3", displayName: "Charlie" }),
    ];
    const { container } = render(<StandingsTable standings={standings} />);
    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(3);
    // First cell of each row should be the rank
    expect(rows[0].querySelector("td")?.textContent).toBe("1");
    expect(rows[1].querySelector("td")?.textContent).toBe("2");
    expect(rows[2].querySelector("td")?.textContent).toBe("3");
  });

  it("displays positive scoreDiff with + prefix", () => {
    const standings = [makeStanding({ scoreDiff: 5 })];
    render(<StandingsTable standings={standings} />);
    expect(screen.getByText("+5")).toBeInTheDocument();
  });

  it("displays negative scoreDiff without + prefix", () => {
    const standings = [makeStanding({ scoreDiff: -3 })];
    render(<StandingsTable standings={standings} />);
    expect(screen.getByText("-3")).toBeInTheDocument();
  });

  it("displays zero scoreDiff as 0", () => {
    const standings = [makeStanding({ scoreDiff: 0, draws: 1 })];
    const { container } = render(<StandingsTable standings={standings} />);
    // The last td in the row is the score diff column
    const cells = container.querySelectorAll("tbody tr td");
    const diffCell = cells[cells.length - 1];
    expect(diffCell.textContent).toBe("0");
  });

  it("highlights row for highlightPlayerId", () => {
    const standings = [
      makeStanding({ playerId: "p1", displayName: "Alice" }),
      makeStanding({ playerId: "p2", displayName: "Bob" }),
    ];
    const { container } = render(<StandingsTable standings={standings} highlightPlayerId="p1" />);
    const rows = container.querySelectorAll("tbody tr");
    expect(rows[0].className).toContain("bg-amber-50");
    expect(rows[1].className).not.toContain("bg-amber-50");
  });

  it("does not highlight any rows when highlightPlayerId is not in standings", () => {
    const standings = [makeStanding({ playerId: "p1" })];
    const { container } = render(<StandingsTable standings={standings} highlightPlayerId="p99" />);
    const rows = container.querySelectorAll("tbody tr");
    expect(rows[0].className).not.toContain("bg-amber-50");
  });
});
