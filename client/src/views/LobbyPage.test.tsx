import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

function makeGameSummary(
  overrides?: Partial<MultiplayerGameSummary>,
): MultiplayerGameSummary {
  return {
    gameId: "ABC123",
    roomType: "direct",
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    currentTurn: "black",
    historyLength: 4,
    winner: null,
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
      refreshMultiplayerGames: vi.fn(),
    });

    const { useSocialData } = await import("@/lib/hooks/useSocialData");
    (useSocialData as ReturnType<typeof vi.fn>).mockReturnValue({
      socialOverview: EMPTY_SOCIAL_OVERVIEW,
      socialLoading: false,
      socialLoaded: false,
      refreshSocialOverview: vi.fn(),
    });
  }

  it("shows rematch requested badge for finished games with opponent rematch request", async () => {
    const finishedGame = makeGameSummary({
      gameId: "REM001",
      status: "finished",
      winner: "black",
      rematch: { requestedBy: ["black"] }, // opponent requested
    });

    await setupMocks({ finished: [finishedGame] });

    render(<LobbyPage />);

    // The rematch game should appear in the active games section
    const gameCard = screen.getByTestId("lobby-game-REM001");
    expect(gameCard).toBeInTheDocument();
    expect(screen.getByText("Rematch requested")).toBeInTheDocument();
    expect(screen.getByText("View")).toBeInTheDocument();
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

  it("does not show finished game in lobby when we already requested rematch", async () => {
    const finishedGame = makeGameSummary({
      gameId: "REM002",
      status: "finished",
      winner: "black",
      rematch: { requestedBy: ["white"] }, // we (white) already requested
    });

    await setupMocks({ finished: [finishedGame] });

    render(<LobbyPage />);

    // Should NOT show - we already requested, only show opponent's request
    expect(screen.queryByTestId("lobby-game-REM002")).not.toBeInTheDocument();
  });

  it("shows toast error and blocks navigation when spectating own active game", async () => {
    const activeGame = makeGameSummary({ gameId: "ABC123", status: "active" });
    await setupMocks({ active: [activeGame] });

    const { toast } = await import("sonner");

    render(<LobbyPage />);

    const spectateInput = screen.getAllByPlaceholderText("Game ID")
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

    const spectateInput = screen.getAllByPlaceholderText("Game ID")
      .find((el) => el.getAttribute("name") === "spectate-id")!;
    fireEvent.change(spectateInput, { target: { value: "FIN999" } });
    fireEvent.submit(spectateInput.closest("form")!);

    expect(toast.error).toHaveBeenCalledWith(
      "That's your own game! Use the game list above to rejoin it.",
    );
  });

  it("allows spectating a game that is not yours", async () => {
    const activeGame = makeGameSummary({ gameId: "ABC123", status: "active" });
    await setupMocks({ active: [activeGame] });

    const { toast } = await import("sonner");

    render(<LobbyPage />);

    const spectateInput = screen.getAllByPlaceholderText("Game ID")
      .find((el) => el.getAttribute("name") === "spectate-id")!;
    fireEvent.change(spectateInput, { target: { value: "XYZ789" } });
    fireEvent.submit(spectateInput.closest("form")!);

    expect(toast.error).not.toHaveBeenCalled();
  });
});
