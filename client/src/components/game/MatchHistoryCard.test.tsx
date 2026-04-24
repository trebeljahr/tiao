import type { MultiplayerGameSummary } from "@shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MatchHistoryCard } from "./MatchHistoryCard";

vi.mock("next-intl", () => ({
  // biome-ignore lint/suspicious/noExplicitAny: explicit any acknowledged
  useTranslations: () => (key: string, values?: Record<string, any>) => {
    if (values) return `${key}:${JSON.stringify(values)}`;
    return key;
  },
  useLocale: () => "en",
}));

vi.mock("@/components/PlayerIdentityRow", () => ({
  PlayerIdentityRow: ({
    player,
    children,
  }: {
    player: { displayName?: string };
    children?: React.ReactNode;
  }) => (
    <div data-testid="player-identity">
      <span>{player?.displayName ?? "?"}</span>
      {children}
    </div>
  ),
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children }: Record<string, unknown>) => <div>{children as React.ReactNode}</div>,
    p: ({ children }: Record<string, unknown>) => <p>{children as React.ReactNode}</p>,
  },
  useAnimationControls: () => ({ start: vi.fn(), set: vi.fn() }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}));

const whitePlayer = {
  playerId: "p1",
  displayName: "Alice",
  kind: "account" as const,
};

const blackPlayer = {
  playerId: "p2",
  displayName: "Bob",
  kind: "account" as const,
};

const baseGame: MultiplayerGameSummary = {
  gameId: "game-42",
  roomType: "direct",
  status: "finished",
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T01:00:00Z",
  currentTurn: "white",
  historyLength: 30,
  winner: "white",
  finishReason: "captured",
  yourSeat: "white",
  score: { white: 10, black: 7 },
  players: [],
  seats: {
    white: { player: whitePlayer, online: false },
    black: { player: blackPlayer, online: false },
  },
  rematch: null,
  boardSize: 19,
  scoreToWin: 10,
  timeControl: null,
  clockMs: null,
};

describe("MatchHistoryCard", () => {
  const defaultProps = {
    game: baseGame,
    playerId: "p1",
    onReview: vi.fn(),
  };

  it("renders without crashing", () => {
    const { container } = render(<MatchHistoryCard {...defaultProps} />);
    expect(container.firstElementChild).toBeTruthy();
  });

  it("shows won badge when player won", () => {
    render(<MatchHistoryCard {...defaultProps} />);
    expect(screen.getByText("won")).toBeInTheDocument();
  });

  it("shows lost badge when player lost", () => {
    const lostGame: MultiplayerGameSummary = {
      ...baseGame,
      winner: "black",
    };
    render(<MatchHistoryCard {...defaultProps} game={lostGame} />);
    expect(screen.getByText("lost")).toBeInTheDocument();
  });

  it("shows colorWon badge when yourSeat is null (spectator)", () => {
    const spectatorGame: MultiplayerGameSummary = {
      ...baseGame,
      yourSeat: null,
    };
    render(<MatchHistoryCard {...defaultProps} game={spectatorGame} />);
    expect(screen.getByText(/colorWon/)).toBeInTheDocument();
  });

  it("shows both player names", () => {
    render(<MatchHistoryCard {...defaultProps} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("shows scores for both players", () => {
    render(<MatchHistoryCard {...defaultProps} />);
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("shows game ID button", () => {
    render(<MatchHistoryCard {...defaultProps} />);
    expect(screen.getByText("game-42")).toBeInTheDocument();
  });

  it("calls onReview when review button clicked", () => {
    const onReview = vi.fn();
    render(<MatchHistoryCard {...defaultProps} onReview={onReview} />);
    fireEvent.click(screen.getByText("review"));
    expect(onReview).toHaveBeenCalledTimes(1);
  });

  it("shows move count", () => {
    render(<MatchHistoryCard {...defaultProps} />);
    expect(screen.getByText(/moves/)).toBeInTheDocument();
  });

  it("shows rating changes when available", () => {
    const ratedGame: MultiplayerGameSummary = {
      ...baseGame,
      ratingBefore: { white: 1000, black: 1000 },
      ratingAfter: { white: 1020, black: 980 },
    };
    render(<MatchHistoryCard {...defaultProps} game={ratedGame} />);
    expect(screen.getByText("+20")).toBeInTheDocument();
    expect(screen.getByText("-20")).toBeInTheDocument();
  });

  it("shows clock times when available", () => {
    const timedGame: MultiplayerGameSummary = {
      ...baseGame,
      timeControl: { initialMs: 300_000, incrementMs: 0 },
      clockMs: { white: 180_000, black: 120_000 },
    };
    render(<MatchHistoryCard {...defaultProps} game={timedGame} />);
    // formatClockTime(180_000) = "3:00", formatClockTime(120_000) = "2:00"
    expect(screen.getByText("3:00")).toBeInTheDocument();
    expect(screen.getByText("2:00")).toBeInTheDocument();
  });

  it("shows reason text for captured finish reason when score target reached", () => {
    render(<MatchHistoryCard {...defaultProps} />);
    // finishReason=captured, white=10 >= scoreToWin=10 so reason should show
    expect(screen.getByText("scoreTargetReached")).toBeInTheDocument();
  });

  it("hides reason text when scores are below target for captured reason", () => {
    const lowScoreGame: MultiplayerGameSummary = {
      ...baseGame,
      score: { white: 5, black: 3 },
    };
    render(<MatchHistoryCard {...defaultProps} game={lowScoreGame} />);
    expect(screen.queryByText("scoreTargetReached")).not.toBeInTheDocument();
  });

  it("applies green border style for won games", () => {
    const { container } = render(<MatchHistoryCard {...defaultProps} />);
    const card = container.firstElementChild!;
    expect(card.className).toContain("border-[#a3c98a]");
  });

  it("applies red border style for lost games", () => {
    const lostGame: MultiplayerGameSummary = {
      ...baseGame,
      winner: "black",
    };
    const { container } = render(<MatchHistoryCard {...defaultProps} game={lostGame} />);
    const card = container.firstElementChild!;
    expect(card.className).toContain("border-[#dba8a0]");
  });

  it("shows a LOSER badge on the non-winning player's row", () => {
    // Both rows render a winner/loser badge so the outcome is visible on both
    // sides, not just the winner. This was added so the user can see at a
    // glance who lost even on their opponent's row.
    render(<MatchHistoryCard {...defaultProps} />);
    expect(screen.getByText("winner")).toBeInTheDocument();
    expect(screen.getByText("loser")).toBeInTheDocument();
  });

  it("does not show any winner/loser badge on tied / unfinished games", () => {
    const tiedGame: MultiplayerGameSummary = {
      ...baseGame,
      winner: null,
    };
    render(<MatchHistoryCard {...defaultProps} game={tiedGame} />);
    expect(screen.queryByText("winner")).not.toBeInTheDocument();
    expect(screen.queryByText("loser")).not.toBeInTheDocument();
  });

  it("renders an infinity symbol for untimed games instead of hiding the clock", () => {
    // Previously the clock pill was only rendered when clockMs was set, so
    // untimed games had nothing where timed games had a remaining time. Now
    // the clock icon is always rendered with "∞" as the value for untimed.
    render(<MatchHistoryCard {...defaultProps} />);
    // Both rows should show ∞ since baseGame has clockMs: null
    expect(screen.getAllByText("∞")).toHaveLength(2);
  });

  it("renders player stats as a single left-aligned row with clock | score | badge+elo", () => {
    // On mobile the stats row lives below the player name (col 2 row 2 of
    // the grid) and is left-aligned to the start of the card; at sm+ it
    // gets ml-auto and right-aligns next to the name. Clock, score, and
    // badge+elo are all separated by "|" characters on every viewport.
    const ratedGame: MultiplayerGameSummary = {
      ...baseGame,
      ratingBefore: { white: 1000, black: 1000 },
      ratingAfter: { white: 1020, black: 980 },
    };
    const { container } = render(<MatchHistoryCard {...defaultProps} game={ratedGame} />);
    // Two PlayerRow stats containers — each has sm:ml-auto (no ml-auto on
    // mobile, which keeps the row left-aligned under the name).
    const statsContainers = container.querySelectorAll(".flex.shrink-0.items-center.sm\\:ml-auto");
    expect(statsContainers.length).toBe(2);
    for (const el of statsContainers) {
      // Single flex row — no flex-col / sm:flex-row toggling anymore.
      expect(el.className).not.toContain("flex-col");
      // Left-aligned on mobile — no ml-auto unless at sm+.
      expect(el.className).not.toMatch(/(^|\s)ml-auto/);
      // "|" separators sit as direct text children between groups.
      const pipes = Array.from(el.children).filter((c) => c.textContent === "|");
      expect(pipes.length).toBe(2);
    }
    // The elo change is still rendered alongside the badge.
    expect(screen.getByText("+20")).toBeInTheDocument();
    expect(screen.getByText("-20")).toBeInTheDocument();
  });

  it("stacks header action buttons and result badge on mobile, inlines at sm+", () => {
    // On mobile: LOST badge + reason stack in the top-left column, copy-id
    // + review button stack in the top-right column. On sm+ both collapse
    // back to inline rows.
    const { container } = render(<MatchHistoryCard {...defaultProps} />);
    // The left group (badge + reason) and right group (copy-id + review).
    const headerGroups = container.querySelectorAll(
      ".flex.flex-col.items-start, .flex.flex-col.items-end",
    );
    const anyMobileStack = Array.from(headerGroups).some((el) =>
      el.className.includes("sm:flex-row"),
    );
    expect(anyMobileStack).toBe(true);
  });

  it("lays out player rows as a 2-col grid on mobile, 3-col at sm+", () => {
    // Regression: the PlayerRow used to be a single flex row, which squeezed
    // the name + badges column on narrow viewports — long badges (e.g.
    // CONTRIBUTOR) got clipped by overflow-hidden. The row now uses a CSS
    // grid so the score/stats cell drops below the name cell on mobile and
    // sits inline on sm+.
    const { container } = render(<MatchHistoryCard {...defaultProps} />);
    const playerRows = container.querySelectorAll(".grid");
    expect(playerRows.length).toBeGreaterThanOrEqual(2);
    for (const row of playerRows) {
      expect(row.className).toContain("grid-cols-[auto_1fr]");
      expect(row.className).toContain("sm:grid-cols-[auto_1fr_auto]");
    }
    // The stats cell spans both columns on mobile (so it sits below the
    // dot + name row and aligns to the very left of the card, not indented
    // under the name column) and falls back to the natural third column at
    // sm+.
    const statsCells = container.querySelectorAll(".col-span-2");
    expect(statsCells.length).toBeGreaterThanOrEqual(2);
    for (const cell of statsCells) {
      expect(cell.className).toContain("sm:col-auto");
    }
  });
});
