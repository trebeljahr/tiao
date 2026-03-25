import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { MultiplayerGamePage } from "./MultiplayerGamePage";
import type { AuthResponse, MultiplayerSnapshot } from "@shared";
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
});
