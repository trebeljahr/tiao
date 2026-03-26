import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { MultiplayerGamePage } from "./MultiplayerGamePage";
import type { AuthResponse, MultiplayerSnapshot, TurnRecord } from "@shared";
import { createInitialGameState, EMPTY_SOCIAL_OVERVIEW } from "@shared";

// --- Mocks ---

const mockConnectToRoom = vi.fn();
const mockSendMultiplayerMessage = vi.fn();
const mockSetMultiplayerSelection = vi.fn();
const mockSetMultiplayerBusy = vi.fn();

vi.mock("@/lib/hooks/useMultiplayerGame", () => ({
  useMultiplayerGame: vi.fn(),
}));

vi.mock("@/lib/hooks/useSocialData", () => ({
  useSocialData: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  accessMultiplayerGame: vi.fn(),
  buildWebSocketUrl: (gameId: string) => `ws://localhost:5005/api/ws?gameId=${gameId}`,
}));

vi.mock("@/lib/useStonePlacementSound", () => ({
  useStonePlacementSound: () => ({ play: vi.fn() }),
}));

vi.mock("@/lib/useWinConfetti", () => ({
  useWinConfetti: vi.fn(),
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

// --- Helpers ---

const guestAuth: AuthResponse = {
  player: {
    kind: "guest",
    playerId: "guest-aaa",
    displayName: "Anonymous",
  },
};

function makeMatchmakingSnapshot(overrides?: Partial<MultiplayerSnapshot>): MultiplayerSnapshot {
  return {
    gameId: "ABC123",
    roomType: "matchmaking",
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    state: createInitialGameState(),
    players: [
      { player: { playerId: "guest-aaa", displayName: "Anonymous", kind: "guest" }, online: true },
      { player: { playerId: "guest-bbb", displayName: "Anonymous", kind: "guest" }, online: true },
    ],
    seats: {
      white: { player: { playerId: "guest-aaa", displayName: "Anonymous", kind: "guest" }, online: true },
      black: { player: { playerId: "guest-bbb", displayName: "Anonymous", kind: "guest" }, online: true },
    },
    rematch: null,
    takeback: null,
    timeControl: null,
    clock: null,
    firstMoveDeadline: null,
    ...overrides,
  };
}

function renderWithRouter(auth: AuthResponse | null, gameId: string) {
  return render(
    <MemoryRouter initialEntries={[`/game/${gameId}`]}>
      <Routes>
        <Route
          path="/game/:gameId"
          element={
            <MultiplayerGamePage
              auth={auth}
              onOpenAuth={vi.fn()}
              onLogout={vi.fn()}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const defaultSocialMock = {
  socialOverview: EMPTY_SOCIAL_OVERVIEW,
  socialLoading: false,
  socialLoaded: false,
  friendSearchQuery: "",
  setFriendSearchQuery: vi.fn(),
  friendSearchResults: [],
  friendSearchBusy: false,
  socialActionBusyKey: null,
  refreshSocialOverview: vi.fn(),
  runFriendSearch: vi.fn(),
  handleSendFriendRequest: vi.fn(),
  handleAcceptFriendRequest: vi.fn(),
  handleDeclineFriendRequest: vi.fn(),
  handleCancelFriendRequest: vi.fn(),
  handleRemoveFriend: vi.fn(),
  handleSendGameInvitation: vi.fn(),
  handleRevokeGameInvitation: vi.fn(),
};

async function setupMocks(
  snapshot: MultiplayerSnapshot,
  overrides?: { connectionState?: string },
) {
  const { useMultiplayerGame } = await import("@/lib/hooks/useMultiplayerGame");
  (useMultiplayerGame as ReturnType<typeof vi.fn>).mockReturnValue({
    multiplayerSnapshot: snapshot,
    multiplayerSelection: null,
    connectionState: overrides?.connectionState ?? "connected",
    connectToRoom: mockConnectToRoom,
    sendMultiplayerMessage: mockSendMultiplayerMessage,
    setMultiplayerSelection: mockSetMultiplayerSelection,
    multiplayerBusy: false,
    setMultiplayerBusy: mockSetMultiplayerBusy,
    multiplayerError: null,
  });

  const { useSocialData } = await import("@/lib/hooks/useSocialData");
  (useSocialData as ReturnType<typeof vi.fn>).mockReturnValue(defaultSocialMock);
}

// --- Tests ---

describe("MultiplayerGamePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders without crashing when two guest players are in a matchmaking game", async () => {
    const snapshot = makeMatchmakingSnapshot();

    const { useMultiplayerGame } = await import("@/lib/hooks/useMultiplayerGame");
    (useMultiplayerGame as ReturnType<typeof vi.fn>).mockReturnValue({
      multiplayerSnapshot: snapshot,
      multiplayerSelection: null,
      connectionState: "connected",
      connectToRoom: mockConnectToRoom,
      sendMultiplayerMessage: mockSendMultiplayerMessage,
      setMultiplayerSelection: mockSetMultiplayerSelection,
      multiplayerBusy: false,
      setMultiplayerBusy: mockSetMultiplayerBusy,
      multiplayerError: null,
    });

    const { useSocialData } = await import("@/lib/hooks/useSocialData");
    (useSocialData as ReturnType<typeof vi.fn>).mockReturnValue({
      socialOverview: EMPTY_SOCIAL_OVERVIEW,
      socialLoading: false,
      socialLoaded: false,
      friendSearchQuery: "",
      setFriendSearchQuery: vi.fn(),
      friendSearchResults: [],
      friendSearchBusy: false,
      socialActionBusyKey: null,
      refreshSocialOverview: vi.fn(),
      runFriendSearch: vi.fn(),
      handleSendFriendRequest: vi.fn(),
      handleAcceptFriendRequest: vi.fn(),
      handleDeclineFriendRequest: vi.fn(),
      handleCancelFriendRequest: vi.fn(),
      handleRemoveFriend: vi.fn(),
      handleSendGameInvitation: vi.fn(),
      handleRevokeGameInvitation: vi.fn(),
    });

    // This should not throw "Cannot read properties of undefined (reading 'friends')"
    expect(() => renderWithRouter(guestAuth, "ABC123")).not.toThrow();

    // Both player names should be visible
    expect(screen.getByText("Live match")).toBeInTheDocument();
  });

  it("does not show befriend button for guest players", async () => {
    const snapshot = makeMatchmakingSnapshot();

    const { useMultiplayerGame } = await import("@/lib/hooks/useMultiplayerGame");
    (useMultiplayerGame as ReturnType<typeof vi.fn>).mockReturnValue({
      multiplayerSnapshot: snapshot,
      multiplayerSelection: null,
      connectionState: "connected",
      connectToRoom: mockConnectToRoom,
      sendMultiplayerMessage: mockSendMultiplayerMessage,
      setMultiplayerSelection: mockSetMultiplayerSelection,
      multiplayerBusy: false,
      setMultiplayerBusy: mockSetMultiplayerBusy,
      multiplayerError: null,
    });

    const { useSocialData } = await import("@/lib/hooks/useSocialData");
    (useSocialData as ReturnType<typeof vi.fn>).mockReturnValue({
      socialOverview: EMPTY_SOCIAL_OVERVIEW,
      socialLoading: false,
      socialLoaded: false,
      friendSearchQuery: "",
      setFriendSearchQuery: vi.fn(),
      friendSearchResults: [],
      friendSearchBusy: false,
      socialActionBusyKey: null,
      refreshSocialOverview: vi.fn(),
      runFriendSearch: vi.fn(),
      handleSendFriendRequest: vi.fn(),
      handleAcceptFriendRequest: vi.fn(),
      handleDeclineFriendRequest: vi.fn(),
      handleCancelFriendRequest: vi.fn(),
      handleRemoveFriend: vi.fn(),
      handleSendGameInvitation: vi.fn(),
      handleRevokeGameInvitation: vi.fn(),
    });

    renderWithRouter(guestAuth, "ABC123");

    // Guest players should not see "Add friend" buttons
    expect(screen.queryByText("Add friend")).not.toBeInTheDocument();
  });

  it("calls useWinConfetti with viewerColor matching the player's seat color", async () => {
    const { useWinConfetti } = await import("@/lib/useWinConfetti");
    const mockUseWinConfetti = useWinConfetti as ReturnType<typeof vi.fn>;

    const snapshot = makeMatchmakingSnapshot();

    const { useMultiplayerGame } = await import("@/lib/hooks/useMultiplayerGame");
    (useMultiplayerGame as ReturnType<typeof vi.fn>).mockReturnValue({
      multiplayerSnapshot: snapshot,
      multiplayerSelection: null,
      connectionState: "connected",
      connectToRoom: mockConnectToRoom,
      sendMultiplayerMessage: mockSendMultiplayerMessage,
      setMultiplayerSelection: mockSetMultiplayerSelection,
      multiplayerBusy: false,
      setMultiplayerBusy: mockSetMultiplayerBusy,
      multiplayerError: null,
    });

    const { useSocialData } = await import("@/lib/hooks/useSocialData");
    (useSocialData as ReturnType<typeof vi.fn>).mockReturnValue({
      socialOverview: EMPTY_SOCIAL_OVERVIEW,
      socialLoading: false,
      socialLoaded: false,
      friendSearchQuery: "",
      setFriendSearchQuery: vi.fn(),
      friendSearchResults: [],
      friendSearchBusy: false,
      socialActionBusyKey: null,
      refreshSocialOverview: vi.fn(),
      runFriendSearch: vi.fn(),
      handleSendFriendRequest: vi.fn(),
      handleAcceptFriendRequest: vi.fn(),
      handleDeclineFriendRequest: vi.fn(),
      handleCancelFriendRequest: vi.fn(),
      handleRemoveFriend: vi.fn(),
      handleSendGameInvitation: vi.fn(),
      handleRevokeGameInvitation: vi.fn(),
    });

    renderWithRouter(guestAuth, "ABC123");

    // guest-aaa is seated at white; game is active (not over) so winner = null
    // useWinConfetti should be called with (null, { viewerColor: "white" })
    expect(mockUseWinConfetti).toHaveBeenCalled();
    const lastCall = mockUseWinConfetti.mock.calls[mockUseWinConfetti.mock.calls.length - 1];
    expect(lastCall[0]).toBeNull(); // no winner — game is active
    expect(lastCall[1]).toEqual({ viewerColor: "white" }); // guest-aaa sits at white
  });

  it("passes null winner to useWinConfetti when in review mode (finished game)", async () => {
    const { useWinConfetti } = await import("@/lib/useWinConfetti");
    const mockUseWinConfetti = useWinConfetti as ReturnType<typeof vi.fn>;

    // Create a finished game snapshot
    const snapshot = makeMatchmakingSnapshot({ status: "finished" });

    const { useMultiplayerGame } = await import("@/lib/hooks/useMultiplayerGame");
    (useMultiplayerGame as ReturnType<typeof vi.fn>).mockReturnValue({
      multiplayerSnapshot: snapshot,
      multiplayerSelection: null,
      connectionState: "connected",
      connectToRoom: mockConnectToRoom,
      sendMultiplayerMessage: mockSendMultiplayerMessage,
      setMultiplayerSelection: mockSetMultiplayerSelection,
      multiplayerBusy: false,
      setMultiplayerBusy: mockSetMultiplayerBusy,
      multiplayerError: null,
    });

    const { useSocialData } = await import("@/lib/hooks/useSocialData");
    (useSocialData as ReturnType<typeof vi.fn>).mockReturnValue({
      socialOverview: EMPTY_SOCIAL_OVERVIEW,
      socialLoading: false,
      socialLoaded: false,
      friendSearchQuery: "",
      setFriendSearchQuery: vi.fn(),
      friendSearchResults: [],
      friendSearchBusy: false,
      socialActionBusyKey: null,
      refreshSocialOverview: vi.fn(),
      runFriendSearch: vi.fn(),
      handleSendFriendRequest: vi.fn(),
      handleAcceptFriendRequest: vi.fn(),
      handleDeclineFriendRequest: vi.fn(),
      handleCancelFriendRequest: vi.fn(),
      handleRemoveFriend: vi.fn(),
      handleSendGameInvitation: vi.fn(),
      handleRevokeGameInvitation: vi.fn(),
    });

    renderWithRouter(guestAuth, "ABC123");

    // In review mode (status=finished), isReviewMode is true, so winner arg
    // should be null to suppress confetti during review.
    expect(mockUseWinConfetti).toHaveBeenCalled();
    const lastCall = mockUseWinConfetti.mock.calls[mockUseWinConfetti.mock.calls.length - 1];
    expect(lastCall[0]).toBeNull(); // review mode → null winner passed
  });

  it("renders review nav buttons in the card header when game is finished with history", async () => {
    const history: TurnRecord[] = [
      { type: "put", color: "white", position: { x: 9, y: 9 } },
      { type: "put", color: "black", position: { x: 10, y: 10 } },
    ];
    const state = createInitialGameState();
    state.history = history;

    const snapshot = makeMatchmakingSnapshot({
      status: "finished",
      state,
    });

    await setupMocks(snapshot);
    renderWithRouter(guestAuth, "ABC123");

    // Review nav buttons should be in the card header area (data-testid)
    const navContainer = screen.getByTestId("review-nav-buttons");
    expect(navContainer).toBeInTheDocument();

    // Should contain all four navigation buttons
    expect(screen.getByLabelText("Go to start")).toBeInTheDocument();
    expect(screen.getByLabelText("Previous move")).toBeInTheDocument();
    expect(screen.getByLabelText("Next move")).toBeInTheDocument();
    expect(screen.getByLabelText("Go to end")).toBeInTheDocument();
  });

  it("does not render review nav buttons when game is active", async () => {
    const snapshot = makeMatchmakingSnapshot({ status: "active" });
    await setupMocks(snapshot);
    renderWithRouter(guestAuth, "ABC123");

    expect(screen.queryByTestId("review-nav-buttons")).not.toBeInTheDocument();
  });

  it("shows rematch toast when opponent requests rematch", async () => {
    const { toast } = await import("sonner");

    const state = createInitialGameState();
    state.score = { black: 10, white: 0 };

    const snapshot = makeMatchmakingSnapshot({
      status: "finished",
      state,
      rematch: { requestedBy: ["black"] }, // opponent (we're white)
    });

    await setupMocks(snapshot);
    renderWithRouter(guestAuth, "ABC123");

    expect(toast).toHaveBeenCalledWith(
      "Opponent wants a rematch!",
      expect.objectContaining({
        description: "Accept or decline in the game panel.",
      }),
    );
  });

  it("shows rematch request sent toast when clicking Rematch button", async () => {
    const { toast } = await import("sonner");

    // Need a finished game with a winner for rematch buttons to show
    const state = createInitialGameState();
    state.history = [{ type: "forfeit", color: "black" }];
    state.score = { black: 0, white: 10 };

    const snapshot = makeMatchmakingSnapshot({
      status: "finished",
      state,
      rematch: null,
    });

    await setupMocks(snapshot);
    renderWithRouter(guestAuth, "ABC123");

    const rematchBtn = screen.getByRole("button", { name: "Rematch" });
    fireEvent.click(rematchBtn);

    expect(mockSendMultiplayerMessage).toHaveBeenCalledWith({
      type: "request-rematch",
    });
    expect(toast.success).toHaveBeenCalledWith("Rematch request sent!");
  });
});
