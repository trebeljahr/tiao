import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MatchHistoryCard } from "./MatchHistoryCard";
import type { MultiplayerGameSummary } from "@shared";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, any>) => {
    if (values) return `${key}:${JSON.stringify(values)}`;
    return key;
  },
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
  kind: "google" as const,
};

const blackPlayer = {
  playerId: "p2",
  displayName: "Bob",
  kind: "google" as const,
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
    copiedId: null,
    onCopy: vi.fn(),
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

  it("shows game ID and calls onCopy when clicked", () => {
    const onCopy = vi.fn();
    render(<MatchHistoryCard {...defaultProps} onCopy={onCopy} />);
    const idButton = screen.getByText("game-42");
    fireEvent.click(idButton);
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it("shows copied text when copiedId matches game ID", () => {
    render(<MatchHistoryCard {...defaultProps} copiedId="game-42" />);
    expect(screen.getByText("copied")).toBeInTheDocument();
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
});
