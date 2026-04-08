import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@/test/navigation-mock";
import { LobbyPage } from "./LobbyPage";
import type { AuthResponse, MultiplayerGameSummary } from "@shared";
import { EMPTY_SOCIAL_OVERVIEW } from "@shared";

vi.mock("@/lib/hooks/useGamesIndex", () => ({
  useGamesIndex: vi.fn(),
}));

vi.mock("@/lib/hooks/useSocialData", () => ({
  useSocialData: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  createMultiplayerGame: vi.fn(),
  joinMultiplayerGame: vi.fn(),
  cancelMultiplayerGame: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock("@/lib/errors", () => ({
  toastError: vi.fn(),
}));

vi.mock("@/lib/SocialNotificationsContext", () => ({
  useSocialNotifications: () => ({
    pendingFriendRequestCount: 0,
    incomingInvitationCount: 0,
    refreshNotifications: vi.fn(),
  }),
}));

vi.mock("@/lib/LobbySocketContext", () => ({
  useLobbyMessage: vi.fn(),
}));

vi.mock("@/lib/hooks/useTournamentList", () => ({
  useTournamentList: () => ({
    publicTournaments: [],
    myTournaments: [],
    loading: false,
    refresh: vi.fn(),
  }),
}));

const accountAuth: AuthResponse = {
  player: {
    kind: "account",
    playerId: "user-123",
    displayName: "TestUser",
    email: "test@example.com",
  },
};

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({
    auth: accountAuth,
    authLoading: false,
    onOpenAuth: vi.fn(),
    onLogout: vi.fn(),
    applyAuth: vi.fn(),
  }),
}));

function makeGameSummary(overrides?: Partial<MultiplayerGameSummary>): MultiplayerGameSummary {
  return {
    gameId: "ABC123",
    roomType: "direct",
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    currentTurn: "black",
    historyLength: 4,
    winner: null,
    finishReason: null,
    yourSeat: "white",
    score: { black: 0, white: 0 },
    players: [
      {
        player: {
          playerId: "user-123",
          displayName: "TestUser",
          kind: "account",
        },
        online: true,
      },
      {
        player: {
          playerId: "user-456",
          displayName: "Opponent",
          kind: "account",
        },
        online: true,
      },
    ],
    seats: {
      white: {
        player: {
          playerId: "user-123",
          displayName: "TestUser",
          kind: "account",
        },
        online: true,
      },
      black: {
        player: {
          playerId: "user-456",
          displayName: "Opponent",
          kind: "account",
        },
        online: true,
      },
    },
    rematch: null,
    boardSize: 19,
    scoreToWin: 5,
    timeControl: null,
    clockMs: null,
    ...overrides,
  };
}

describe("LobbyPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function setupMocks(options?: {
    active?: MultiplayerGameSummary[];
    finished?: MultiplayerGameSummary[];
  }) {
    const { useGamesIndex } = await import("@/lib/hooks/useGamesIndex");
    (useGamesIndex as ReturnType<typeof vi.fn>).mockReturnValue({
      multiplayerGames: {
        active: options?.active ?? [],
        finished: options?.finished ?? [],
      },
      multiplayerGamesLoaded: true,
      refreshMultiplayerGames: vi.fn(),
    });

    const { useSocialData } = await import("@/lib/hooks/useSocialData");
    (useSocialData as ReturnType<typeof vi.fn>).mockReturnValue({
      socialOverview: EMPTY_SOCIAL_OVERVIEW,
      socialLoading: false,
      socialLoaded: false,
      refreshSocialOverview: vi.fn(),
      handleDeclineGameInvitation: vi.fn(),
    });
  }

  it("shows incoming rematch requests in the invitations section with Accept/Decline", async () => {
    const finishedGame = makeGameSummary({
      gameId: "REM001",
      status: "finished",
      winner: "black",
      rematch: { requestedBy: ["black"] }, // opponent requested, waiting on us
    });

    await setupMocks({ finished: [finishedGame] });

    render(<LobbyPage />);

    // Incoming rematches now live in the invitations section (alongside game
    // invitations) and carry inline Accept/Decline buttons — not in the
    // active games list with a "View" button like before.
    const rematchCard = screen.getByTestId("lobby-rematch-REM001");
    expect(rematchCard).toBeInTheDocument();
    expect(screen.queryByTestId("lobby-game-REM001")).not.toBeInTheDocument();
    // Accept/Decline buttons are rendered
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
  });

  it("does not show finished games without rematch requests in active section", async () => {
    const finishedGame = makeGameSummary({
      gameId: "FIN001",
      status: "finished",
      winner: "black",
      rematch: null,
    });

    await setupMocks({ finished: [finishedGame] });

    render(<LobbyPage />);

    expect(screen.queryByTestId("lobby-game-FIN001")).not.toBeInTheDocument();
  });

  it("shows finished game in lobby when we already requested rematch (so we can cancel)", async () => {
    const finishedGame = makeGameSummary({
      gameId: "REM002",
      status: "finished",
      winner: "black",
      rematch: { requestedBy: ["white"] }, // we (white) already requested
    });

    await setupMocks({ finished: [finishedGame] });

    render(<LobbyPage />);

    // Should show — outgoing rematches are visible so the player can cancel
    await waitFor(() => {
      expect(screen.getByTestId("lobby-game-REM002")).toBeInTheDocument();
    });
  });

  it("shows toast error and blocks navigation when spectating own active game", async () => {
    const activeGame = makeGameSummary({ gameId: "ABC123", status: "active" });
    await setupMocks({ active: [activeGame] });

    const { toast } = await import("sonner");

    render(<LobbyPage />);

    const spectateInput = screen
      .getAllByPlaceholderText("Game ID")
      .find((el) => el.getAttribute("name") === "spectate-id")!;
    fireEvent.change(spectateInput, { target: { value: "ABC123" } });
    fireEvent.submit(spectateInput.closest("form")!);

    expect(toast.error).toHaveBeenCalledWith(
      "That's your own game! Use the game list above to rejoin it.",
    );
  });

  it("shows toast error when spectating own finished game", async () => {
    const finishedGame = makeGameSummary({
      gameId: "FIN999",
      status: "finished",
      winner: "black",
    });
    await setupMocks({ finished: [finishedGame] });

    const { toast } = await import("sonner");

    render(<LobbyPage />);

    const spectateInput = screen
      .getAllByPlaceholderText("Game ID")
      .find((el) => el.getAttribute("name") === "spectate-id")!;
    fireEvent.change(spectateInput, { target: { value: "FIN999" } });
    fireEvent.submit(spectateInput.closest("form")!);

    expect(toast.error).toHaveBeenCalledWith(
      "That's your own game! Use the game list above to rejoin it.",
    );
  });

  it("shows 'Waiting' badge instead of 'Their move' for waiting games", async () => {
    const waitingGame = makeGameSummary({
      gameId: "WAIT01",
      status: "waiting",
      currentTurn: "white",
      yourSeat: "white",
      seats: {
        white: {
          player: {
            playerId: "user-123",
            displayName: "TestUser",
            kind: "account",
          },
          online: true,
        },
        black: null as any,
      },
    });

    await setupMocks({ active: [waitingGame] });
    render(<LobbyPage />);

    const gameCard = screen.getByTestId("lobby-game-WAIT01");
    expect(gameCard).toBeInTheDocument();
    expect(gameCard).toHaveTextContent("Waiting");
    expect(gameCard).not.toHaveTextContent("Their move");
  });

  it("shows 'Waiting for opponent' instead of 'vs' for waiting games without opponent", async () => {
    const waitingGame = makeGameSummary({
      gameId: "WAIT02",
      status: "waiting",
      currentTurn: "white",
      yourSeat: "white",
      seats: {
        white: {
          player: {
            playerId: "user-123",
            displayName: "TestUser",
            kind: "account",
          },
          online: true,
        },
        black: null as any,
      },
    });

    await setupMocks({ active: [waitingGame] });
    render(<LobbyPage />);

    const gameCard = screen.getByTestId("lobby-game-WAIT02");
    expect(gameCard).toHaveTextContent("Waiting for opponent");
    // Should not show "vs" prefix when no opponent
    expect(gameCard).not.toHaveTextContent(/vs /);
  });

  it("shows Delete button instead of Cancel for waiting games", async () => {
    const waitingGame = makeGameSummary({
      gameId: "WAIT03",
      status: "waiting",
      currentTurn: "white",
      yourSeat: "white",
      seats: {
        white: {
          player: {
            playerId: "user-123",
            displayName: "TestUser",
            kind: "account",
          },
          online: true,
        },
        black: null as any,
      },
    });

    await setupMocks({ active: [waitingGame] });
    render(<LobbyPage />);

    const gameCard = screen.getByTestId("lobby-game-WAIT03");
    expect(gameCard).toHaveTextContent("Delete");
  });

  it("renders active game card with testid", async () => {
    const activeGame = makeGameSummary({ gameId: "ABC123", status: "active" });
    await setupMocks({ active: [activeGame] });
    render(<LobbyPage />);

    const gameCard = screen.getByTestId("lobby-game-ABC123");
    expect(gameCard).toBeInTheDocument();
  });

  it("allows spectating a game that is not yours", async () => {
    const activeGame = makeGameSummary({ gameId: "ABC123", status: "active" });
    await setupMocks({ active: [activeGame] });

    const { toast } = await import("sonner");

    render(<LobbyPage />);

    const spectateInput = screen
      .getAllByPlaceholderText("Game ID")
      .find((el) => el.getAttribute("name") === "spectate-id")!;
    fireEvent.change(spectateInput, { target: { value: "XYZ789" } });
    fireEvent.submit(spectateInput.closest("form")!);

    expect(toast.error).not.toHaveBeenCalled();
  });

  // --- "your move" toast regression suite -----------------------------------
  //
  // The lobby toasts "Your move in {gameId}" when an opponent makes a move.
  // It must NEVER toast on the first game-update seen for a given game in a
  // session — otherwise a player who navigates back to the lobby while it's
  // their turn gets the toast for the very game they just left. This
  // regression has returned multiple times; these tests are its guard.
  describe("'your move' toast on game-update", () => {
    async function captureLobbyMessageHandler() {
      const { useLobbyMessage } = await import("@/lib/LobbySocketContext");
      // Capture the handler passed by LobbyPage. useLobbyMessage is called
      // on every render, so we grab the most recent call.
      const mocked = useLobbyMessage as ReturnType<typeof vi.fn>;
      const calls = mocked.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      return calls[calls.length - 1][0] as (payload: unknown) => void;
    }

    it("does not fire your-move toast for a game on first sight after leaving it", async () => {
      // Simulate "player was in /game/ABC123 on their turn, just came back
      // to the lobby". The game is already known via the initial fetch.
      const leftGame = makeGameSummary({
        gameId: "ABC123",
        status: "active",
        historyLength: 7,
        currentTurn: "white", // our seat
        yourSeat: "white",
      });
      await setupMocks({ active: [leftGame] });

      const { toast } = await import("sonner");

      render(<LobbyPage />);

      // A game-update arrives for the game we just left — same history
      // length, still our turn. This must NOT trigger a "your move" toast.
      const handler = await captureLobbyMessageHandler();
      handler({ type: "game-update", summary: leftGame });

      expect(toast.info).not.toHaveBeenCalled();
    });

    it("does not fire your-move toast on first game-update even when ref is empty and fetch hasn't loaded yet", async () => {
      // Edge case: the game-update arrives BEFORE the initial active-games
      // fetch populates the ref. This is the tightest version of the bug —
      // ref is fully empty, game is unknown to the UI, yet the toast would
      // previously fire because `prevLen ?? 0` treated history > 0 as new.
      await setupMocks({ active: [] });

      const { toast } = await import("sonner");

      render(<LobbyPage />);

      const handler = await captureLobbyMessageHandler();
      handler({
        type: "game-update",
        summary: makeGameSummary({
          gameId: "ZZZ999",
          status: "active",
          historyLength: 12,
          currentTurn: "white",
          yourSeat: "white",
        }),
      });

      expect(toast.info).not.toHaveBeenCalled();
    });

    it("fires your-move toast when opponent actually makes a move (positive case)", async () => {
      // Baseline: game is on opponent's turn, historyLength=7.
      const baseline = makeGameSummary({
        gameId: "DEF456",
        status: "active",
        historyLength: 7,
        currentTurn: "black", // opponent
        yourSeat: "white",
      });
      await setupMocks({ active: [baseline] });

      const { toast } = await import("sonner");

      render(<LobbyPage />);

      // Wait for the seeding effect to run (runs after render commit).
      await waitFor(() => {
        // Trigger an opponent-move game-update: historyLength bumps and
        // currentTurn flips to our seat.
        const handler = (async () => captureLobbyMessageHandler())();
        return handler;
      });

      const handler = await captureLobbyMessageHandler();
      handler({
        type: "game-update",
        summary: { ...baseline, historyLength: 8, currentTurn: "white" },
      });

      expect(toast.info).toHaveBeenCalledTimes(1);
      expect(toast.info).toHaveBeenCalledWith(
        expect.stringContaining("DEF456"),
        expect.objectContaining({ id: "your-turn-DEF456" }),
      );
    });

    it("does not fire your-move toast when history length does not change", async () => {
      // A game-update with the same historyLength (e.g. a player-online
      // status change) must never toast.
      const baseline = makeGameSummary({
        gameId: "GHI789",
        status: "active",
        historyLength: 5,
        currentTurn: "white",
        yourSeat: "white",
      });
      await setupMocks({ active: [baseline] });

      const { toast } = await import("sonner");

      render(<LobbyPage />);

      const handler = await captureLobbyMessageHandler();
      // First event: bootstraps the ref (our fix swallows this). Second
      // event with identical history must also not toast.
      handler({ type: "game-update", summary: baseline });
      handler({ type: "game-update", summary: baseline });

      expect(toast.info).not.toHaveBeenCalled();
    });

    it("does not fire your-move toast when the user is still on the game page", async () => {
      // usePathname is mocked to "/" globally. Override for this test so
      // window.location.pathname begins with /game/.
      const originalLocation = window.location;
      // @ts-expect-error — overriding for test
      delete window.location;
      // @ts-expect-error — minimal stub
      window.location = { ...originalLocation, pathname: "/game/JKL000" };

      try {
        const baseline = makeGameSummary({
          gameId: "JKL000",
          status: "active",
          historyLength: 4,
          currentTurn: "black",
          yourSeat: "white",
        });
        await setupMocks({ active: [baseline] });

        const { toast } = await import("sonner");

        render(<LobbyPage />);

        const handler = await captureLobbyMessageHandler();
        // Bootstrap (first event is swallowed by our fix anyway) plus a
        // real move: opponent moves, historyLength bumps.
        handler({ type: "game-update", summary: baseline });
        handler({
          type: "game-update",
          summary: { ...baseline, historyLength: 5, currentTurn: "white" },
        });

        expect(toast.info).not.toHaveBeenCalled();
      } finally {
        // @ts-expect-error — restore
        window.location = originalLocation;
      }
    });
  });
});
