import type { PublicGameReplay } from "@shared";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmbedGamePage } from "./EmbedGamePage";

vi.mock("next/navigation", () => ({
  useParams: () => ({ gameId: "ABC123" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/embed/game/ABC123",
  useSearchParams: () => new URLSearchParams(),
}));

const getGameReplay = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    getGameReplay: (...args: unknown[]) => getGameReplay(...args),
  };
});

function makeReplay(overrides: Partial<PublicGameReplay> = {}): PublicGameReplay {
  return {
    gameId: "ABC123",
    status: "finished",
    boardSize: 19,
    scoreToWin: 10,
    score: { white: 10, black: 3 },
    history: [
      { type: "put", color: "white", position: { x: 9, y: 9 } },
      { type: "put", color: "black", position: { x: 10, y: 10 } },
      { type: "put", color: "white", position: { x: 8, y: 8 } },
      { type: "forfeit", color: "black" },
    ],
    winner: "white",
    finishReason: "forfeit",
    white: { displayName: "Alice" },
    black: { displayName: "Bob" },
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:30:00.000Z",
    ...overrides,
  };
}

describe("EmbedGamePage", () => {
  beforeEach(() => {
    getGameReplay.mockReset();
  });

  it("loads the public replay, shows the final position and steps through moves", async () => {
    getGameReplay.mockResolvedValue({ replay: makeReplay() });
    render(<EmbedGamePage />);

    expect(getGameReplay).toHaveBeenCalledWith("ABC123");
    await waitFor(() => expect(screen.getByTestId("embed-board")).toBeInTheDocument());

    expect(screen.getByTestId("embed-players")).toHaveTextContent("Alice");
    expect(screen.getByTestId("embed-players")).toHaveTextContent("Bob");
    expect(screen.getByTestId("embed-result")).toHaveTextContent("Alice wins");
    // Starts on the last *board* move — the trailing forfeit record is skipped.
    expect(screen.getByTestId("embed-move-counter")).toHaveTextContent("Move 3 of 3");

    fireEvent.click(screen.getByLabelText("Previous move"));
    expect(screen.getByTestId("embed-move-counter")).toHaveTextContent("Move 2 of 3");

    fireEvent.click(screen.getByLabelText("Go to start"));
    expect(screen.getByTestId("embed-move-counter")).toHaveTextContent("Move 0 of 3");

    fireEvent.click(screen.getByLabelText("Next move"));
    expect(screen.getByTestId("embed-move-counter")).toHaveTextContent("Move 1 of 3");

    fireEvent.click(screen.getByLabelText("Go to end"));
    expect(screen.getByTestId("embed-move-counter")).toHaveTextContent("Move 3 of 3");

    act(() => {
      fireEvent.keyDown(window, { key: "ArrowLeft" });
    });
    expect(screen.getByTestId("embed-move-counter")).toHaveTextContent("Move 2 of 3");
  });

  it("links back to the full game page in a new tab", async () => {
    getGameReplay.mockResolvedValue({ replay: makeReplay() });
    render(<EmbedGamePage />);
    await waitFor(() => expect(screen.getByTestId("embed-board")).toBeInTheDocument());

    const link = screen.getByTestId("embed-open-link");
    expect(link).toHaveAttribute("href", "/game/ABC123");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("explains when the game has not finished yet", async () => {
    const { ApiError } = await import("@/lib/api");
    getGameReplay.mockRejectedValue(
      new ApiError(404, "Only finished games can be replayed.", "GAME_NOT_FINISHED"),
    );
    render(<EmbedGamePage />);

    await waitFor(() =>
      expect(screen.getByTestId("embed-error")).toHaveTextContent(
        "This game can be replayed once it has finished.",
      ),
    );
    expect(screen.queryByTestId("embed-board")).not.toBeInTheDocument();
    expect(screen.queryByTestId("review-nav-buttons")).not.toBeInTheDocument();
  });

  it("shows a not-found message for unknown games", async () => {
    const { ApiError } = await import("@/lib/api");
    getGameReplay.mockRejectedValue(new ApiError(404, "Game not found.", "ROOM_NOT_FOUND"));
    render(<EmbedGamePage />);

    await waitFor(() =>
      expect(screen.getByTestId("embed-error")).toHaveTextContent("Game not found."),
    );
  });
});
