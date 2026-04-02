import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ActiveGameCard } from "./ActiveGameCard";
import type { MultiplayerGameSummary } from "@shared";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, any>) => {
    if (values) return `${key}:${JSON.stringify(values)}`;
    return key;
  },
}));

vi.mock("@/components/PlayerIdentityRow", () => ({
  PlayerIdentityRow: ({ player }: { player: { displayName?: string } }) => (
    <span data-testid="player-identity">{player?.displayName ?? "?"}</span>
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

const baseGame: MultiplayerGameSummary = {
  gameId: "game-1",
  roomType: "direct",
  status: "active",
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T01:00:00Z",
  currentTurn: "white",
  historyLength: 12,
  winner: null,
  finishReason: null,
  yourSeat: "white",
  score: { white: 3, black: 2 },
  players: [],
  seats: {
    white: {
      player: { playerId: "me", displayName: "Me", kind: "account" },
      online: true,
    },
    black: {
      player: { playerId: "opp", displayName: "Opponent", kind: "account" },
      online: true,
    },
  },
  rematch: null,
  boardSize: 19,
  scoreToWin: 10,
  timeControl: null,
  clockMs: null,
};

describe("ActiveGameCard", () => {
  it("renders without crashing", () => {
    const { container } = render(<ActiveGameCard game={baseGame} onResume={vi.fn()} />);
    expect(container.firstElementChild).toBeTruthy();
  });

  it("shows resume button for active games", () => {
    render(<ActiveGameCard game={baseGame} onResume={vi.fn()} />);
    expect(screen.getByText("resume")).toBeInTheDocument();
  });

  it("calls onResume when resume button clicked", () => {
    const onResume = vi.fn();
    render(<ActiveGameCard game={baseGame} onResume={onResume} />);
    fireEvent.click(screen.getByText("resume"));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("shows view button for waiting games", () => {
    const waitingGame = { ...baseGame, status: "waiting" as const };
    render(<ActiveGameCard game={waitingGame} onResume={vi.fn()} />);
    expect(screen.getByText("view")).toBeInTheDocument();
  });

  it("shows cancel button for waiting games with onDelete", () => {
    const waitingGame = { ...baseGame, status: "waiting" as const };
    const onDelete = vi.fn();
    render(<ActiveGameCard game={waitingGame} onResume={vi.fn()} onDelete={onDelete} />);
    expect(screen.getByText("cancel")).toBeInTheDocument();
  });

  it("calls onDelete when cancel button clicked", () => {
    const waitingGame = { ...baseGame, status: "waiting" as const };
    const onDelete = vi.fn();
    render(<ActiveGameCard game={waitingGame} onResume={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByText("cancel"));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("disables cancel button when deleting", () => {
    const waitingGame = { ...baseGame, status: "waiting" as const };
    render(<ActiveGameCard game={waitingGame} onResume={vi.fn()} onDelete={vi.fn()} deleting />);
    // When deleting, shows "..." instead of cancel text
    expect(screen.getByText("…")).toBeInTheDocument();
  });

  it("shows waiting for opponent when no opponent and waiting", () => {
    const waitingGame: MultiplayerGameSummary = {
      ...baseGame,
      status: "waiting",
      seats: { white: baseGame.seats.white, black: null },
    };
    render(<ActiveGameCard game={waitingGame} onResume={vi.fn()} />);
    expect(screen.getByText("waitingForOpponent")).toBeInTheDocument();
  });

  it("shows opponent name when opponent is present", () => {
    render(<ActiveGameCard game={baseGame} onResume={vi.fn()} />);
    expect(screen.getByText("Opponent")).toBeInTheDocument();
  });

  it("shows online indicator when opponent is online", () => {
    render(<ActiveGameCard game={baseGame} onResume={vi.fn()} />);
    const onlineIndicator = document.querySelector("[title='opponentOnline']");
    expect(onlineIndicator).toBeInTheDocument();
  });

  it("hides online indicator when opponent is offline", () => {
    const offlineGame: MultiplayerGameSummary = {
      ...baseGame,
      seats: {
        white: baseGame.seats.white,
        black: {
          player: { playerId: "opp", displayName: "Opponent", kind: "account" },
          online: false,
        },
      },
    };
    render(<ActiveGameCard game={offlineGame} onResume={vi.fn()} />);
    const onlineIndicator = document.querySelector("[title='opponentOnline']");
    expect(onlineIndicator).not.toBeInTheDocument();
  });

  it("shows move count", () => {
    render(<ActiveGameCard game={baseGame} onResume={vi.fn()} />);
    expect(screen.getByText(/moves/)).toBeInTheDocument();
  });

  it("shows score values", () => {
    render(<ActiveGameCard game={baseGame} onResume={vi.fn()} />);
    // Your score (white = 3)
    expect(screen.getByText("3")).toBeInTheDocument();
    // Opponent score (black = 2)
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("shows view button for rematch requested games", () => {
    const rematchGame: MultiplayerGameSummary = {
      ...baseGame,
      status: "finished",
      winner: "white",
      rematch: { requestedBy: ["white"] },
    };
    render(<ActiveGameCard game={rematchGame} onResume={vi.fn()} />);
    expect(screen.getByText("view")).toBeInTheDocument();
  });

  it("shows rematchRequested badge for games with rematch request", () => {
    const rematchGame: MultiplayerGameSummary = {
      ...baseGame,
      status: "finished",
      winner: "white",
      rematch: { requestedBy: ["white"] },
    };
    render(<ActiveGameCard game={rematchGame} onResume={vi.fn()} />);
    expect(screen.getByText("rematchRequested")).toBeInTheDocument();
  });

  it("applies data-testid prop", () => {
    render(<ActiveGameCard game={baseGame} onResume={vi.fn()} data-testid="my-card" />);
    expect(screen.getByTestId("my-card")).toBeInTheDocument();
  });
});
