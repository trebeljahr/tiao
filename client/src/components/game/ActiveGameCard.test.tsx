import type { MultiplayerGameSummary } from "@shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActiveGameCard } from "./ActiveGameCard";

vi.mock("next-intl", () => ({
  // biome-ignore lint/suspicious/noExplicitAny: explicit any acknowledged
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

  it("shows delete button for waiting games with onDelete", () => {
    const waitingGame = { ...baseGame, status: "waiting" as const };
    const onDelete = vi.fn();
    render(<ActiveGameCard game={waitingGame} onResume={vi.fn()} onDelete={onDelete} />);
    expect(screen.getByText("delete")).toBeInTheDocument();
  });

  it("calls onDelete when delete button clicked", () => {
    const waitingGame = { ...baseGame, status: "waiting" as const };
    const onDelete = vi.fn();
    render(<ActiveGameCard game={waitingGame} onResume={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByText("delete"));
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

  it("shows rematchRequested badge for incoming rematch request", () => {
    const rematchGame: MultiplayerGameSummary = {
      ...baseGame,
      status: "finished",
      winner: "white",
      rematch: { requestedBy: ["black"] },
    };
    render(<ActiveGameCard game={rematchGame} onResume={vi.fn()} />);
    expect(screen.getByText("rematchRequested")).toBeInTheDocument();
  });

  it("shows rematchSent badge for outgoing rematch request", () => {
    const rematchGame: MultiplayerGameSummary = {
      ...baseGame,
      status: "finished",
      winner: "white",
      rematch: { requestedBy: ["white"] },
    };
    render(<ActiveGameCard game={rematchGame} onResume={vi.fn()} />);
    expect(screen.getByText("rematchSent")).toBeInTheDocument();
  });

  it("shows cancel button when you sent a rematch and onCancelRematch is provided", () => {
    const rematchGame: MultiplayerGameSummary = {
      ...baseGame,
      status: "finished",
      winner: "white",
      rematch: { requestedBy: ["white"] },
    };
    const onCancelRematch = vi.fn();
    render(
      <ActiveGameCard game={rematchGame} onResume={vi.fn()} onCancelRematch={onCancelRematch} />,
    );
    const cancelButton = screen.getByText("cancel");
    expect(cancelButton).toBeInTheDocument();
    fireEvent.click(cancelButton);
    expect(onCancelRematch).toHaveBeenCalled();
  });

  it("does not show cancel button for incoming rematch request", () => {
    const rematchGame: MultiplayerGameSummary = {
      ...baseGame,
      status: "finished",
      winner: "white",
      rematch: { requestedBy: ["black"] },
    };
    render(<ActiveGameCard game={rematchGame} onResume={vi.fn()} onCancelRematch={vi.fn()} />);
    expect(screen.queryByText("cancel")).not.toBeInTheDocument();
  });

  it("applies data-testid prop", () => {
    render(<ActiveGameCard game={baseGame} onResume={vi.fn()} data-testid="my-card" />);
    expect(screen.getByTestId("my-card")).toBeInTheDocument();
  });

  it("renders a copyable game id pill next to resume", () => {
    render(<ActiveGameCard game={baseGame} onResume={vi.fn()} />);
    const idButton = screen.getByText("game-1");
    expect(idButton).toBeInTheDocument();
    expect(idButton.tagName).toBe("BUTTON");
    // White variant uses bg-white styling
    expect(idButton.className).toContain("bg-white");
  });

  it("stacks the settings/actions header on mobile, inline on sm+", () => {
    // Regression: the header row used to be a single flex row at all widths,
    // which caused the config text ("Matchmaking | 19x19 | 10pts | Unlimited")
    // to wrap across 3 lines on narrow viewports. The row now stacks vertically
    // below the sm breakpoint and becomes inline at sm+.
    render(<ActiveGameCard game={baseGame} onResume={vi.fn()} />);
    const resumeBtn = screen.getByText("resume");
    const headerRow = resumeBtn.closest("div")!.parentElement!;
    expect(headerRow.className).toContain("flex-col");
    expect(headerRow.className).toContain("sm:flex-row");
  });

  it("buttons group is left-aligned on mobile and right-aligned at sm+", () => {
    // The Resume + copy-id buttons should sit under the settings badge on
    // mobile, left-aligned with the card edge (not right-aligned). At sm+
    // they move onto the same row as the settings and right-align.
    render(<ActiveGameCard game={baseGame} onResume={vi.fn()} />);
    const buttonsGroup = screen.getByText("resume").closest("div")!;
    expect(buttonsGroup.className).toContain("justify-start");
    expect(buttonsGroup.className).toContain("sm:justify-end");
  });

  it("renders clock pills when clockMs is set on a timed game", () => {
    // Timed games carry a clockMs snapshot on their summary. The card should
    // surface both players' remaining time alongside the score.
    const timedGame: MultiplayerGameSummary = {
      ...baseGame,
      timeControl: { initialMs: 300_000, incrementMs: 3_000 },
      clockMs: { white: 180_000, black: 120_000 },
    };
    render(<ActiveGameCard game={timedGame} onResume={vi.fn()} />);
    // formatClockTime(180_000) = "3:00", formatClockTime(120_000) = "2:00"
    expect(screen.getByText("3:00")).toBeInTheDocument();
    expect(screen.getByText("2:00")).toBeInTheDocument();
  });

  it("renders an infinity symbol on untimed games instead of hiding the clock pill", () => {
    // Previously the clock pill was omitted when clockMs was null, but we now
    // always render the pill so timed and untimed games share the same layout.
    // For untimed games the value is "∞" (matching MatchHistoryCard).
    render(<ActiveGameCard game={baseGame} onResume={vi.fn()} />);
    expect(screen.queryByText(/^\d+:\d{2}$/)).not.toBeInTheDocument();
    // One pill per player row: your row + opponent row.
    expect(screen.getAllByText("∞")).toHaveLength(2);
  });

  it("player-row stats cell wraps to its own row on mobile via CSS grid", () => {
    // Mobile fix: on narrow viewports the clock + score pair should drop
    // below the player name (col 2, row 2 of the grid) instead of squeezing
    // next to it. At sm+, the stats cell sits on the right of the same row.
    render(<ActiveGameCard game={baseGame} onResume={vi.fn()} />);
    // The "vs." opponent row grid container.
    const vsLabel = screen.getByText("vs.");
    const gridRow = vsLabel.closest(".grid")!;
    expect(gridRow.className).toContain("grid-cols-[auto_1fr]");
    expect(gridRow.className).toContain("sm:grid-cols-[auto_1fr_auto]");
    // And the stats cell spans both columns on mobile (so the clock + score
    // row aligns to the very left of the card, under the dot) and sm:col-auto
    // (normal flow) on wider screens.
    const statsCells = gridRow.querySelectorAll(".col-span-2");
    expect(statsCells.length).toBeGreaterThan(0);
  });
});
