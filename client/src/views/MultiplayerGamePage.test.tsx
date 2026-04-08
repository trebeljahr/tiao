import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MultiplayerGamePage } from "./MultiplayerGamePage";
import type { AuthResponse, MultiplayerSnapshot, TurnRecord } from "@shared";
import { createInitialGameState, EMPTY_SOCIAL_OVERVIEW } from "@shared";

// --- Mock next/navigation ---

const mockPush = vi.fn();
const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/game/ABC123",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ gameId: "ABC123" }),
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
  notFound: vi.fn(),
  useSelectedLayoutSegment: () => null,
  useSelectedLayoutSegments: () => [],
}));

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

vi.mock("canvas-confetti", () => ({
  default: Object.assign(vi.fn(), {
    create: vi.fn(() => vi.fn()),
  }),
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

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({
    auth: guestAuth,
    authLoading: false,
    onOpenAuth: vi.fn(),
    onLogout: vi.fn(),
    applyAuth: vi.fn(),
  }),
}));

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
      white: {
        player: { playerId: "guest-aaa", displayName: "Anonymous", kind: "guest" },
        online: true,
      },
      black: {
        player: { playerId: "guest-bbb", displayName: "Anonymous", kind: "guest" },
        online: true,
      },
    },
    spectators: [],
    rematch: null,
    takeback: null,
    timeControl: null,
    clock: null,
    firstMoveDeadline: null,
    ...overrides,
  };
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

async function setupMocks(snapshot: MultiplayerSnapshot, overrides?: { connectionState?: string }) {
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
    expect(() => render(<MultiplayerGamePage />)).not.toThrow();

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

    render(<MultiplayerGamePage />);

    // Guest players should not see "Add friend" buttons
    expect(screen.queryByText("Add friend")).not.toBeInTheDocument();
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
    render(<MultiplayerGamePage />);

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
    render(<MultiplayerGamePage />);

    expect(screen.queryByTestId("review-nav-buttons")).not.toBeInTheDocument();
  });

  it("shows rematch toast when opponent requests rematch after initial load", async () => {
    const { toast } = await import("sonner");
    const { useMultiplayerGame } = await import("@/lib/hooks/useMultiplayerGame");
    const { useSocialData } = await import("@/lib/hooks/useSocialData");
    (useSocialData as ReturnType<typeof vi.fn>).mockReturnValue(defaultSocialMock);

    const state = createInitialGameState();
    state.score = { black: 10, white: 0 };

    // First render: finished game, no rematch yet
    const snapshotNoRematch = makeMatchmakingSnapshot({
      status: "finished",
      state,
      rematch: null,
    });

    (useMultiplayerGame as ReturnType<typeof vi.fn>).mockReturnValue({
      multiplayerSnapshot: snapshotNoRematch,
      multiplayerSelection: null,
      connectionState: "connected",
      connectToRoom: mockConnectToRoom,
      sendMultiplayerMessage: mockSendMultiplayerMessage,
      setMultiplayerSelection: mockSetMultiplayerSelection,
      multiplayerBusy: false,
      setMultiplayerBusy: mockSetMultiplayerBusy,
      multiplayerError: null,
    });

    const { rerender } = render(<MultiplayerGamePage />);

    // Second render: opponent requests rematch (simulates live snapshot update)
    const snapshotWithRematch = makeMatchmakingSnapshot({
      status: "finished",
      state,
      rematch: { requestedBy: ["black"] }, // opponent (we're white)
    });

    (useMultiplayerGame as ReturnType<typeof vi.fn>).mockReturnValue({
      multiplayerSnapshot: snapshotWithRematch,
      multiplayerSelection: null,
      connectionState: "connected",
      connectToRoom: mockConnectToRoom,
      sendMultiplayerMessage: mockSendMultiplayerMessage,
      setMultiplayerSelection: mockSetMultiplayerSelection,
      multiplayerBusy: false,
      setMultiplayerBusy: mockSetMultiplayerBusy,
      multiplayerError: null,
    });

    rerender(<MultiplayerGamePage />);

    expect(toast).toHaveBeenCalledWith(
      expect.stringContaining("wants a rematch!"),
      expect.objectContaining({
        action: expect.objectContaining({ label: "Accept" }),
        cancel: expect.objectContaining({ label: "Decline" }),
        duration: Infinity,
      }),
    );
  });

  it("shows rematch request sent toast when clicking Rematch button", async () => {
    const { toast } = await import("sonner");
    const { useMultiplayerGame } = await import("@/lib/hooks/useMultiplayerGame");
    const { useSocialData } = await import("@/lib/hooks/useSocialData");
    (useSocialData as ReturnType<typeof vi.fn>).mockReturnValue(defaultSocialMock);

    // First render: active game (so wasFinishedOnLoadRef stays false)
    const activeSnapshot = makeMatchmakingSnapshot({ status: "active" });
    (useMultiplayerGame as ReturnType<typeof vi.fn>).mockReturnValue({
      multiplayerSnapshot: activeSnapshot,
      multiplayerSelection: null,
      connectionState: "connected",
      connectToRoom: mockConnectToRoom,
      sendMultiplayerMessage: mockSendMultiplayerMessage,
      setMultiplayerSelection: mockSetMultiplayerSelection,
      multiplayerBusy: false,
      setMultiplayerBusy: mockSetMultiplayerBusy,
      multiplayerError: null,
    });

    const { rerender } = render(<MultiplayerGamePage />);

    // Second render: game becomes finished with a winner — opens game-over dialog
    const state = createInitialGameState();
    state.history = [{ type: "forfeit", color: "black" }];
    state.score = { black: 0, white: 10 };

    const finishedSnapshot = makeMatchmakingSnapshot({
      status: "finished",
      state,
      rematch: null,
    });

    (useMultiplayerGame as ReturnType<typeof vi.fn>).mockReturnValue({
      multiplayerSnapshot: finishedSnapshot,
      multiplayerSelection: null,
      connectionState: "connected",
      connectToRoom: mockConnectToRoom,
      sendMultiplayerMessage: mockSendMultiplayerMessage,
      setMultiplayerSelection: mockSetMultiplayerSelection,
      multiplayerBusy: false,
      setMultiplayerBusy: mockSetMultiplayerBusy,
      multiplayerError: null,
    });

    rerender(<MultiplayerGamePage />);

    const rematchBtns = await screen.findAllByRole("button", { name: "Rematch" });
    fireEvent.click(rematchBtns[0]);

    expect(mockSendMultiplayerMessage).toHaveBeenCalledWith({
      type: "request-rematch",
    });
    expect(toast.success).toHaveBeenCalledWith("Rematch request sent!");
  });

  it("shows spectator badge when spectators are present", async () => {
    const snapshot = makeMatchmakingSnapshot({
      spectators: [
        {
          player: { playerId: "spec-1", displayName: "Spectator1", kind: "account" },
          online: true,
        },
        {
          player: { playerId: "spec-2", displayName: "Spectator2", kind: "guest" },
          online: true,
        },
      ],
    });

    await setupMocks(snapshot);
    render(<MultiplayerGamePage />);

    // Spectator badge shows count
    const badge = screen.getByTitle("2 spectators");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("2");
  });

  it("hides spectator badge when no spectators", async () => {
    const snapshot = makeMatchmakingSnapshot({ spectators: [] });
    await setupMocks(snapshot);
    render(<MultiplayerGamePage />);

    expect(screen.queryByTitle(/spectator/)).not.toBeInTheDocument();
  });

  it("shows 'Spectating' title when user is not a player", async () => {
    const spectatorAuth: AuthResponse = {
      player: {
        kind: "guest",
        playerId: "spectator-xyz",
        displayName: "Watcher",
      },
    };

    // Re-mock useAuth to return spectator identity
    const authModule = await import("@/lib/AuthContext");
    vi.spyOn(authModule, "useAuth").mockReturnValue({
      auth: spectatorAuth,
      authLoading: false,
      appError: null,
      authDialogOpen: false,
      authDialogForced: false,
      authDialogMode: "login",
      authBusy: false,
      authDialogError: null,
      loginEmail: "",
      loginPassword: "",
      signupDisplayName: "",
      signupEmail: "",
      signupPassword: "",
      signupConfirmPassword: "",
      setAuth: vi.fn(),
      setAuthDialogOpen: vi.fn(),
      setAuthDialogMode: vi.fn(),
      setAuthDialogError: vi.fn(),
      setLoginEmail: vi.fn(),
      setLoginPassword: vi.fn(),
      setSignupDisplayName: vi.fn(),
      setSignupEmail: vi.fn(),
      setSignupPassword: vi.fn(),
      setSignupConfirmPassword: vi.fn(),
      onOpenAuth: vi.fn(),
      handleLoginSubmit: vi.fn(),
      handleSignupSubmit: vi.fn(),
      handleForgotPassword: vi.fn(),
      handleOAuthSignIn: vi.fn(),
      onLogout: vi.fn(),
      applyAuth: vi.fn(),
    });

    const snapshot = makeMatchmakingSnapshot({ spectators: [] });
    await setupMocks(snapshot);
    render(<MultiplayerGamePage />);

    const spectatingElements = screen.getAllByText("Spectating");
    expect(spectatingElements.length).toBeGreaterThan(0);
  });

  it("does NOT call accessMultiplayerGame while the rules-intro modal is open, even if auth re-renders with a fresh reference", async () => {
    // Regression for the gating bug where the tutorial-check effect's
    // rulesIntroShownRef made the second run of the effect (triggered by a
    // fresh auth object reference, e.g. from a social/profile re-fetch) take
    // the else-branch and silently call setReadyToJoin(true) — which fired
    // accessMultiplayerGame and the "Game started!" toast on top of the open
    // modal. The fix is a one-shot tutorialCheckDoneRef that bails on
    // re-runs after the first decision.
    localStorage.removeItem("tiao:knowsHowToPlay");

    const newAccountAuth: AuthResponse = {
      player: {
        kind: "account",
        playerId: "new-account-xyz",
        displayName: "newuser",
        email: "new@test.com",
        hasSeenTutorial: false,
        badges: [],
        activeBadges: [],
        unlockedThemes: [],
        rating: 1500,
      },
    };

    const authModule = await import("@/lib/AuthContext");
    // mockImplementation so each call returns a *fresh object reference* with
    // the same content — exactly the situation that broke the gating.
    const useAuthSpy = vi.spyOn(authModule, "useAuth").mockImplementation(
      () =>
        ({
          auth: { player: { ...newAccountAuth.player } },
          authLoading: false,
          appError: null,
          authDialogOpen: false,
          authDialogForced: false,
          authDialogMode: "login",
          authBusy: false,
          authDialogError: null,
          loginEmail: "",
          loginPassword: "",
          signupDisplayName: "",
          signupEmail: "",
          signupPassword: "",
          signupConfirmPassword: "",
          setAuth: vi.fn(),
          setAuthDialogOpen: vi.fn(),
          setAuthDialogMode: vi.fn(),
          setAuthDialogError: vi.fn(),
          setLoginEmail: vi.fn(),
          setLoginPassword: vi.fn(),
          setSignupDisplayName: vi.fn(),
          setSignupEmail: vi.fn(),
          setSignupPassword: vi.fn(),
          setSignupConfirmPassword: vi.fn(),
          onOpenAuth: vi.fn(),
          handleLoginSubmit: vi.fn(),
          handleSignupSubmit: vi.fn(),
          handleForgotPassword: vi.fn(),
          handleOAuthSignIn: vi.fn(),
          onLogout: vi.fn(),
          applyAuth: vi.fn(),
        }) as ReturnType<typeof authModule.useAuth>,
    );

    // useMultiplayerGame must report null snapshot + idle connection so the
    // page's loadGame effect would fire if the gating broke.
    const { useMultiplayerGame } = await import("@/lib/hooks/useMultiplayerGame");
    (useMultiplayerGame as ReturnType<typeof vi.fn>).mockReturnValue({
      multiplayerSnapshot: null,
      multiplayerSelection: null,
      connectionState: "idle",
      connectToRoom: mockConnectToRoom,
      sendMultiplayerMessage: mockSendMultiplayerMessage,
      setMultiplayerSelection: mockSetMultiplayerSelection,
      multiplayerBusy: false,
      setMultiplayerBusy: mockSetMultiplayerBusy,
      multiplayerError: null,
    });

    const { useSocialData } = await import("@/lib/hooks/useSocialData");
    (useSocialData as ReturnType<typeof vi.fn>).mockReturnValue(defaultSocialMock);

    const apiModule = await import("@/lib/api");
    (apiModule.accessMultiplayerGame as ReturnType<typeof vi.fn>).mockClear();

    const { rerender } = render(<MultiplayerGamePage />);

    // The modal should be visible
    expect(screen.getByText("Welcome to Tiao!")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Learn how to play first/i })).toBeInTheDocument();

    // Force a re-render — useAuth's mock returns a fresh object reference,
    // which used to flip the `rulesIntroShownRef` guard and let the else
    // branch silently set readyToJoin=true.
    rerender(<MultiplayerGamePage />);
    rerender(<MultiplayerGamePage />);

    // accessMultiplayerGame must NOT have been called — the modal is still up
    // and the user has not made a decision.
    expect(apiModule.accessMultiplayerGame).not.toHaveBeenCalled();

    // The modal must STILL be visible after the re-renders.
    expect(screen.getByText("Welcome to Tiao!")).toBeInTheDocument();

    useAuthSpy.mockRestore();
  });

  it("shows 'Start Spectating' button in rules intro for spectators", async () => {
    localStorage.removeItem("tiao:knowsHowToPlay");

    const spectatorAuth: AuthResponse = {
      player: {
        kind: "guest",
        playerId: "spectator-xyz",
        displayName: "Watcher",
      },
    };

    const authModule = await import("@/lib/AuthContext");
    vi.spyOn(authModule, "useAuth").mockReturnValue({
      auth: spectatorAuth,
      authLoading: false,
      appError: null,
      authDialogOpen: false,
      authDialogForced: false,
      authDialogMode: "login",
      authBusy: false,
      authDialogError: null,
      loginEmail: "",
      loginPassword: "",
      signupDisplayName: "",
      signupEmail: "",
      signupPassword: "",
      signupConfirmPassword: "",
      setAuth: vi.fn(),
      setAuthDialogOpen: vi.fn(),
      setAuthDialogMode: vi.fn(),
      setAuthDialogError: vi.fn(),
      setLoginEmail: vi.fn(),
      setLoginPassword: vi.fn(),
      setSignupDisplayName: vi.fn(),
      setSignupEmail: vi.fn(),
      setSignupPassword: vi.fn(),
      setSignupConfirmPassword: vi.fn(),
      onOpenAuth: vi.fn(),
      handleLoginSubmit: vi.fn(),
      handleSignupSubmit: vi.fn(),
      handleForgotPassword: vi.fn(),
      handleOAuthSignIn: vi.fn(),
      onLogout: vi.fn(),
      applyAuth: vi.fn(),
    });

    const snapshot = makeMatchmakingSnapshot({ spectators: [] });
    await setupMocks(snapshot);
    render(<MultiplayerGamePage />);

    // The rules intro dialog should show "Start Spectating" instead of the
    // "Learn how to play first" / "I've played before" CTAs that players see.
    expect(screen.getByRole("button", { name: "Start Spectating" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /I've played before/i })).not.toBeInTheDocument();
  });

  it("shows 'Back to lobby' button for spectators", async () => {
    const spectatorAuth: AuthResponse = {
      player: {
        kind: "guest",
        playerId: "spectator-xyz",
        displayName: "Watcher",
      },
    };

    // Re-mock useAuth to return spectator identity
    const authModule = await import("@/lib/AuthContext");
    vi.spyOn(authModule, "useAuth").mockReturnValue({
      auth: spectatorAuth,
      authLoading: false,
      appError: null,
      authDialogOpen: false,
      authDialogForced: false,
      authDialogMode: "login",
      authBusy: false,
      authDialogError: null,
      loginEmail: "",
      loginPassword: "",
      signupDisplayName: "",
      signupEmail: "",
      signupPassword: "",
      signupConfirmPassword: "",
      setAuth: vi.fn(),
      setAuthDialogOpen: vi.fn(),
      setAuthDialogMode: vi.fn(),
      setAuthDialogError: vi.fn(),
      setLoginEmail: vi.fn(),
      setLoginPassword: vi.fn(),
      setSignupDisplayName: vi.fn(),
      setSignupEmail: vi.fn(),
      setSignupPassword: vi.fn(),
      setSignupConfirmPassword: vi.fn(),
      onOpenAuth: vi.fn(),
      handleLoginSubmit: vi.fn(),
      handleSignupSubmit: vi.fn(),
      handleForgotPassword: vi.fn(),
      handleOAuthSignIn: vi.fn(),
      onLogout: vi.fn(),
      applyAuth: vi.fn(),
    });

    const snapshot = makeMatchmakingSnapshot({ spectators: [] });
    await setupMocks(snapshot);
    render(<MultiplayerGamePage />);

    expect(screen.getByRole("button", { name: "Back to lobby" })).toBeInTheDocument();
  });

  it("shows winner info (not 'you lost') in game-over dialog for spectators", async () => {
    const spectatorAuth: AuthResponse = {
      player: {
        kind: "guest",
        playerId: "spectator-xyz",
        displayName: "Watcher",
      },
    };

    const authModule = await import("@/lib/AuthContext");
    vi.spyOn(authModule, "useAuth").mockReturnValue({
      auth: spectatorAuth,
      authLoading: false,
      appError: null,
      authDialogOpen: false,
      authDialogForced: false,
      authDialogMode: "login",
      authBusy: false,
      authDialogError: null,
      loginEmail: "",
      loginPassword: "",
      signupDisplayName: "",
      signupEmail: "",
      signupPassword: "",
      signupConfirmPassword: "",
      setAuth: vi.fn(),
      setAuthDialogOpen: vi.fn(),
      setAuthDialogMode: vi.fn(),
      setAuthDialogError: vi.fn(),
      setLoginEmail: vi.fn(),
      setLoginPassword: vi.fn(),
      setSignupDisplayName: vi.fn(),
      setSignupEmail: vi.fn(),
      setSignupPassword: vi.fn(),
      setSignupConfirmPassword: vi.fn(),
      onOpenAuth: vi.fn(),
      handleLoginSubmit: vi.fn(),
      handleSignupSubmit: vi.fn(),
      handleForgotPassword: vi.fn(),
      handleOAuthSignIn: vi.fn(),
      onLogout: vi.fn(),
      applyAuth: vi.fn(),
    });

    // Create a finished game where white won (spectator is not a participant)
    const state = createInitialGameState();
    state.history = [{ type: "forfeit", color: "black" }];
    state.score = { black: 0, white: 10 };

    const snapshot = makeMatchmakingSnapshot({
      status: "finished",
      state,
      seats: {
        white: {
          player: { playerId: "player-1", displayName: "Alice", kind: "account" },
          online: true,
        },
        black: {
          player: { playerId: "player-2", displayName: "Bob", kind: "account" },
          online: true,
        },
      },
    });

    await setupMocks(snapshot);
    render(<MultiplayerGamePage />);

    // The dialog title should NOT say "You lost!" — it should say "White wins!"
    expect(screen.queryByText("You lost!")).not.toBeInTheDocument();
    // "White wins" should appear as the card title (always visible in side panel)
    expect(screen.getByText("White wins")).toBeInTheDocument();
  });

  it("does not fire confetti for spectators", async () => {
    const confettiModule = await import("canvas-confetti");
    const mockCreate = confettiModule.default.create as ReturnType<typeof vi.fn>;
    mockCreate.mockClear();

    const spectatorAuth: AuthResponse = {
      player: {
        kind: "guest",
        playerId: "spectator-xyz",
        displayName: "Watcher",
      },
    };

    const authModule = await import("@/lib/AuthContext");
    vi.spyOn(authModule, "useAuth").mockReturnValue({
      auth: spectatorAuth,
      authLoading: false,
      appError: null,
      authDialogOpen: false,
      authDialogForced: false,
      authDialogMode: "login",
      authBusy: false,
      authDialogError: null,
      loginEmail: "",
      loginPassword: "",
      signupDisplayName: "",
      signupEmail: "",
      signupPassword: "",
      signupConfirmPassword: "",
      setAuth: vi.fn(),
      setAuthDialogOpen: vi.fn(),
      setAuthDialogMode: vi.fn(),
      setAuthDialogError: vi.fn(),
      setLoginEmail: vi.fn(),
      setLoginPassword: vi.fn(),
      setSignupDisplayName: vi.fn(),
      setSignupEmail: vi.fn(),
      setSignupPassword: vi.fn(),
      setSignupConfirmPassword: vi.fn(),
      onOpenAuth: vi.fn(),
      handleLoginSubmit: vi.fn(),
      handleSignupSubmit: vi.fn(),
      handleForgotPassword: vi.fn(),
      handleOAuthSignIn: vi.fn(),
      onLogout: vi.fn(),
      applyAuth: vi.fn(),
    });

    const state = createInitialGameState();
    state.history = [{ type: "forfeit", color: "black" }];
    state.score = { black: 0, white: 10 };

    const snapshot = makeMatchmakingSnapshot({
      status: "finished",
      state,
    });

    await setupMocks(snapshot);
    render(<MultiplayerGamePage />);

    // confetti.create should NOT be called for spectators
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("shows 'Back to tournament' instead of 'Back to lobby' for tournament games", async () => {
    const state = createInitialGameState();
    state.history = [{ type: "forfeit", color: "black" }];
    state.score = { black: 0, white: 10 };

    const snapshot = makeMatchmakingSnapshot({
      roomType: "tournament",
      tournamentId: "tourney-123",
      status: "finished",
      state,
    });

    await setupMocks(snapshot);
    render(<MultiplayerGamePage />);

    // Should show "Back to tournament" instead of "Back to lobby"
    const backBtns = screen.getAllByRole("button", { name: "Back to tournament" });
    expect(backBtns.length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Back to lobby" })).not.toBeInTheDocument();

    // Clicking the first one should navigate to the tournament page
    fireEvent.click(backBtns[0]);
    expect(mockPush).toHaveBeenCalledWith("/tournament/tourney-123");
  });

  it("shows tournament-specific actions instead of rematch for tournament games", async () => {
    const accountAuth: AuthResponse = {
      player: {
        kind: "account",
        playerId: "account-aaa",
        displayName: "TourneyPlayer",
      },
    };

    const authModule = await import("@/lib/AuthContext");
    vi.spyOn(authModule, "useAuth").mockReturnValue({
      auth: accountAuth,
      authLoading: false,
      appError: null,
      authDialogOpen: false,
      authDialogForced: false,
      authDialogMode: "login",
      authBusy: false,
      authDialogError: null,
      loginEmail: "",
      loginPassword: "",
      signupDisplayName: "",
      signupEmail: "",
      signupPassword: "",
      signupConfirmPassword: "",
      setAuth: vi.fn(),
      setAuthDialogOpen: vi.fn(),
      setAuthDialogMode: vi.fn(),
      setAuthDialogError: vi.fn(),
      setLoginEmail: vi.fn(),
      setLoginPassword: vi.fn(),
      setSignupDisplayName: vi.fn(),
      setSignupEmail: vi.fn(),
      setSignupPassword: vi.fn(),
      setSignupConfirmPassword: vi.fn(),
      onOpenAuth: vi.fn(),
      handleLoginSubmit: vi.fn(),
      handleSignupSubmit: vi.fn(),
      handleForgotPassword: vi.fn(),
      handleOAuthSignIn: vi.fn(),
      onLogout: vi.fn(),
      applyAuth: vi.fn(),
    });

    const state = createInitialGameState();
    state.history = [{ type: "forfeit", color: "black" }];
    state.score = { black: 0, white: 10 };

    const snapshot: MultiplayerSnapshot = {
      gameId: "ABC123",
      roomType: "tournament",
      tournamentId: "tourney-456",
      status: "finished",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      state,
      players: [
        {
          player: { playerId: "account-aaa", displayName: "TourneyPlayer", kind: "account" },
          online: true,
        },
        {
          player: { playerId: "account-bbb", displayName: "Opponent Bob", kind: "account" },
          online: true,
        },
      ],
      seats: {
        white: {
          player: { playerId: "account-aaa", displayName: "TourneyPlayer", kind: "account" },
          online: true,
        },
        black: {
          player: { playerId: "account-bbb", displayName: "Opponent Bob", kind: "account" },
          online: true,
        },
      },
      spectators: [],
      rematch: null,
      takeback: null,
      timeControl: null,
      clock: null,
      firstMoveDeadline: null,
    };

    await setupMocks(snapshot);
    render(<MultiplayerGamePage />);

    // Should NOT show rematch button for tournament games
    expect(screen.queryByRole("button", { name: "Rematch" })).not.toBeInTheDocument();

    // Should show "Go to your next match" button
    const nextMatchBtns = screen.getAllByRole("button", { name: "Go to your next match" });
    expect(nextMatchBtns.length).toBeGreaterThan(0);

    // Should show "Add friend" button (for the opponent)
    const addFriendBtns = screen.getAllByRole("button", { name: /Add friend/i });
    expect(addFriendBtns.length).toBeGreaterThan(0);

    // Should show "Back to tournament" buttons
    const backBtns = screen.getAllByRole("button", { name: "Back to tournament" });
    expect(backBtns.length).toBeGreaterThan(0);
  });

  // --- #90: Spectate link always visible ---

  // Note: eye icon rendering with 0 spectators and clipboard copy are covered
  // by e2e/spectateLink.spec.ts since the unit test environment doesn't fully
  // render the game board UI.

  // --- #81: Invite friends button in waiting game room ---

  it("shows invite button for account creator in a waiting game with one player", async () => {
    const accountAuth: AuthResponse = {
      player: {
        kind: "account",
        playerId: "account-aaa",
        displayName: "Alice",
      },
    };

    const authModule = await import("@/lib/AuthContext");
    vi.spyOn(authModule, "useAuth").mockReturnValue({
      auth: accountAuth,
      authLoading: false,
      appError: null,
      authDialogOpen: false,
      authDialogForced: false,
      authDialogMode: "login",
      authBusy: false,
      authDialogError: null,
      loginEmail: "",
      loginPassword: "",
      signupDisplayName: "",
      signupEmail: "",
      signupPassword: "",
      signupConfirmPassword: "",
      setAuth: vi.fn(),
      setAuthDialogOpen: vi.fn(),
      setAuthDialogMode: vi.fn(),
      setAuthDialogError: vi.fn(),
      setLoginEmail: vi.fn(),
      setLoginPassword: vi.fn(),
      setSignupDisplayName: vi.fn(),
      setSignupEmail: vi.fn(),
      setSignupPassword: vi.fn(),
      setSignupConfirmPassword: vi.fn(),
      onOpenAuth: vi.fn(),
      handleLoginSubmit: vi.fn(),
      handleSignupSubmit: vi.fn(),
      handleForgotPassword: vi.fn(),
      handleOAuthSignIn: vi.fn(),
      onLogout: vi.fn(),
      applyAuth: vi.fn(),
    });

    // Waiting game: 1 player seated as white, black seat empty (< 2 players)
    const snapshot = makeMatchmakingSnapshot({
      roomType: "direct",
      status: "waiting",
      players: [
        {
          player: { playerId: "account-aaa", displayName: "Alice", kind: "account" },
          online: true,
        },
      ],
      seats: {
        white: {
          player: { playerId: "account-aaa", displayName: "Alice", kind: "account" },
          online: true,
        },
        black: null,
      },
    });

    await setupMocks(snapshot);
    render(<MultiplayerGamePage />);

    expect(screen.getByRole("button", { name: "Invite a Friend" })).toBeInTheDocument();
  });

  it("shows invite button for account creator before seats are assigned", async () => {
    const accountAuth: AuthResponse = {
      player: {
        kind: "account",
        playerId: "account-aaa",
        displayName: "Alice",
      },
    };

    const authModule = await import("@/lib/AuthContext");
    vi.spyOn(authModule, "useAuth").mockReturnValue({
      auth: accountAuth,
      authLoading: false,
      appError: null,
      authDialogOpen: false,
      authDialogForced: false,
      authDialogMode: "login",
      authBusy: false,
      authDialogError: null,
      loginEmail: "",
      loginPassword: "",
      signupDisplayName: "",
      signupEmail: "",
      signupPassword: "",
      signupConfirmPassword: "",
      setAuth: vi.fn(),
      setAuthDialogOpen: vi.fn(),
      setAuthDialogMode: vi.fn(),
      setAuthDialogError: vi.fn(),
      setLoginEmail: vi.fn(),
      setLoginPassword: vi.fn(),
      setSignupDisplayName: vi.fn(),
      setSignupEmail: vi.fn(),
      setSignupPassword: vi.fn(),
      setSignupConfirmPassword: vi.fn(),
      onOpenAuth: vi.fn(),
      handleLoginSubmit: vi.fn(),
      handleSignupSubmit: vi.fn(),
      handleForgotPassword: vi.fn(),
      handleOAuthSignIn: vi.fn(),
      onLogout: vi.fn(),
      applyAuth: vi.fn(),
    });

    // Creator is in players list but seats are NOT yet assigned (the regression scenario)
    const snapshot = makeMatchmakingSnapshot({
      roomType: "direct",
      status: "waiting",
      players: [
        {
          player: { playerId: "account-aaa", displayName: "Alice", kind: "account" },
          online: true,
        },
      ],
      seats: { white: null, black: null },
    });

    await setupMocks(snapshot);
    render(<MultiplayerGamePage />);

    expect(screen.getByRole("button", { name: "Invite a Friend" })).toBeInTheDocument();
  });

  it("does not show invite button for guest creator in a waiting game", async () => {
    // guestAuth is the default mock — kind: "guest"
    const snapshot = makeMatchmakingSnapshot({
      roomType: "direct",
      status: "waiting",
      players: [
        {
          player: { playerId: "guest-aaa", displayName: "Anonymous", kind: "guest" },
          online: true,
        },
      ],
      seats: { white: null, black: null },
    });

    await setupMocks(snapshot);
    render(<MultiplayerGamePage />);

    expect(screen.queryByRole("button", { name: "Invite a Friend" })).not.toBeInTheDocument();
  });

  it("does not show invite button when both slots are filled in a waiting game", async () => {
    const accountAuth: AuthResponse = {
      player: {
        kind: "account",
        playerId: "account-aaa",
        displayName: "Alice",
      },
    };

    const authModule = await import("@/lib/AuthContext");
    vi.spyOn(authModule, "useAuth").mockReturnValue({
      auth: accountAuth,
      authLoading: false,
      appError: null,
      authDialogOpen: false,
      authDialogForced: false,
      authDialogMode: "login",
      authBusy: false,
      authDialogError: null,
      loginEmail: "",
      loginPassword: "",
      signupDisplayName: "",
      signupEmail: "",
      signupPassword: "",
      signupConfirmPassword: "",
      setAuth: vi.fn(),
      setAuthDialogOpen: vi.fn(),
      setAuthDialogMode: vi.fn(),
      setAuthDialogError: vi.fn(),
      setLoginEmail: vi.fn(),
      setLoginPassword: vi.fn(),
      setSignupDisplayName: vi.fn(),
      setSignupEmail: vi.fn(),
      setSignupPassword: vi.fn(),
      setSignupConfirmPassword: vi.fn(),
      onOpenAuth: vi.fn(),
      handleLoginSubmit: vi.fn(),
      handleSignupSubmit: vi.fn(),
      handleForgotPassword: vi.fn(),
      handleOAuthSignIn: vi.fn(),
      onLogout: vi.fn(),
      applyAuth: vi.fn(),
    });

    // Both players present, seats filled — no empty slot to show invite on
    const snapshot = makeMatchmakingSnapshot({
      roomType: "direct",
      status: "waiting",
      players: [
        {
          player: { playerId: "account-aaa", displayName: "Alice", kind: "account" },
          online: true,
        },
        {
          player: { playerId: "account-bbb", displayName: "Bob", kind: "account" },
          online: true,
        },
      ],
    });

    await setupMocks(snapshot);
    render(<MultiplayerGamePage />);

    expect(screen.queryByRole("button", { name: "Invite a Friend" })).not.toBeInTheDocument();
  });

  it("shows 'Game resumed' toast (not 'Game started!') when re-opening an active game with both seats already filled", async () => {
    // Regression: prevBothSeatedRef used to be initialized from a render where
    // snapshot was still null, so the first real snapshot looked like a
    // false→true transition and fired the "Game started!" toast even though
    // the game had been in progress for a while.
    const { toast } = await import("sonner");
    (toast as unknown as ReturnType<typeof vi.fn>).mockClear();

    // Reset useAuth to the default guest mock — earlier tests in the file
    // install vi.spyOn mocks that persist across tests.
    const authModule = await import("@/lib/AuthContext");
    vi.spyOn(authModule, "useAuth").mockReturnValue({
      auth: guestAuth,
      authLoading: false,
      onOpenAuth: vi.fn(),
      onLogout: vi.fn(),
      applyAuth: vi.fn(),
    } as unknown as ReturnType<typeof authModule.useAuth>);

    const snapshot = makeMatchmakingSnapshot({ status: "active" });
    await setupMocks(snapshot);
    render(<MultiplayerGamePage />);

    expect(toast).toHaveBeenCalledWith("Game resumed");
    expect(toast).not.toHaveBeenCalledWith("Game started!");
  });

  it("does not toast 'Game resumed' for spectators re-joining an active game", async () => {
    const { toast } = await import("sonner");
    (toast as unknown as ReturnType<typeof vi.fn>).mockClear();

    // Spectator (not in players list)
    const spectatorAuth: AuthResponse = {
      player: {
        kind: "guest",
        playerId: "watcher-xyz",
        displayName: "Watcher",
      },
    };
    const authModule = await import("@/lib/AuthContext");
    vi.spyOn(authModule, "useAuth").mockReturnValue({
      auth: spectatorAuth,
      authLoading: false,
      appError: null,
      authDialogOpen: false,
      authDialogForced: false,
      authDialogMode: "login",
      authBusy: false,
      authDialogError: null,
      loginEmail: "",
      loginPassword: "",
      signupDisplayName: "",
      signupEmail: "",
      signupPassword: "",
      signupConfirmPassword: "",
      setAuth: vi.fn(),
      setAuthDialogOpen: vi.fn(),
      setAuthDialogMode: vi.fn(),
      setAuthDialogError: vi.fn(),
      setLoginEmail: vi.fn(),
      setLoginPassword: vi.fn(),
      setSignupDisplayName: vi.fn(),
      setSignupEmail: vi.fn(),
      setSignupPassword: vi.fn(),
      setSignupConfirmPassword: vi.fn(),
      onOpenAuth: vi.fn(),
      handleLoginSubmit: vi.fn(),
      handleSignupSubmit: vi.fn(),
      handleForgotPassword: vi.fn(),
      handleOAuthSignIn: vi.fn(),
      onLogout: vi.fn(),
      applyAuth: vi.fn(),
    } as ReturnType<typeof authModule.useAuth>);

    // Snapshot has two OTHER players seated; the watcher is not in either seat.
    const snapshot = makeMatchmakingSnapshot({ status: "active" });
    await setupMocks(snapshot);
    render(<MultiplayerGamePage />);

    expect(toast).not.toHaveBeenCalledWith("Game resumed");
    expect(toast).not.toHaveBeenCalledWith("Game started!");
  });

  it("fires 'Game started!' when both seats transition from not-both → both during page lifetime", async () => {
    const { toast } = await import("sonner");
    (toast as unknown as ReturnType<typeof vi.fn>).mockClear();

    const { useMultiplayerGame } = await import("@/lib/hooks/useMultiplayerGame");
    const { useSocialData } = await import("@/lib/hooks/useSocialData");
    (useSocialData as ReturnType<typeof vi.fn>).mockReturnValue(defaultSocialMock);

    // First render: only white seated, status waiting
    const waitingSnapshot = makeMatchmakingSnapshot({
      status: "waiting",
      seats: {
        white: {
          player: { playerId: "guest-aaa", displayName: "Anonymous", kind: "guest" },
          online: true,
        },
        black: null,
      },
    });
    (useMultiplayerGame as ReturnType<typeof vi.fn>).mockReturnValue({
      multiplayerSnapshot: waitingSnapshot,
      multiplayerSelection: null,
      connectionState: "connected",
      connectToRoom: mockConnectToRoom,
      sendMultiplayerMessage: mockSendMultiplayerMessage,
      setMultiplayerSelection: mockSetMultiplayerSelection,
      multiplayerBusy: false,
      setMultiplayerBusy: mockSetMultiplayerBusy,
      multiplayerError: null,
    });
    const { rerender } = render(<MultiplayerGamePage />);
    expect(toast).not.toHaveBeenCalledWith("Game started!");
    expect(toast).not.toHaveBeenCalledWith("Game resumed");

    // Second render: both seats now filled
    const startedSnapshot = makeMatchmakingSnapshot({ status: "active" });
    (useMultiplayerGame as ReturnType<typeof vi.fn>).mockReturnValue({
      multiplayerSnapshot: startedSnapshot,
      multiplayerSelection: null,
      connectionState: "connected",
      connectToRoom: mockConnectToRoom,
      sendMultiplayerMessage: mockSendMultiplayerMessage,
      setMultiplayerSelection: mockSetMultiplayerSelection,
      multiplayerBusy: false,
      setMultiplayerBusy: mockSetMultiplayerBusy,
      multiplayerError: null,
    });
    rerender(<MultiplayerGamePage />);

    expect(toast).toHaveBeenCalledWith("Game started!");
  });

  it("renders LoadingBoardSkeleton on first render when snapshot is not yet loaded", async () => {
    // Set knowsHowToPlay so the rules-intro modal doesn't open and hide the skeleton.
    localStorage.setItem("tiao:knowsHowToPlay", "1");

    const { useMultiplayerGame } = await import("@/lib/hooks/useMultiplayerGame");
    (useMultiplayerGame as ReturnType<typeof vi.fn>).mockReturnValue({
      multiplayerSnapshot: null,
      multiplayerSelection: null,
      connectionState: "idle",
      connectToRoom: mockConnectToRoom,
      sendMultiplayerMessage: mockSendMultiplayerMessage,
      setMultiplayerSelection: mockSetMultiplayerSelection,
      // Critically: busy=false. The previous condition only rendered the
      // skeleton while busy was true, so the very first render fell through
      // to the main return body and produced a white flash.
      multiplayerBusy: false,
      setMultiplayerBusy: mockSetMultiplayerBusy,
      multiplayerError: null,
    });
    const { useSocialData } = await import("@/lib/hooks/useSocialData");
    (useSocialData as ReturnType<typeof vi.fn>).mockReturnValue(defaultSocialMock);

    render(<MultiplayerGamePage />);

    // The skeleton has a "Loading…" label; the live page does not.
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("displays spectator count next to eye icon when spectatorCount > 0", async () => {
    const snapshot = makeMatchmakingSnapshot({
      spectators: [
        {
          player: { playerId: "spec-1", displayName: "Watcher1", kind: "guest" },
          online: true,
        },
        {
          player: { playerId: "spec-2", displayName: "Watcher2", kind: "guest" },
          online: true,
        },
      ],
    });
    await setupMocks(snapshot);
    render(<MultiplayerGamePage />);

    // With spectators, the count should be shown next to the eye
    const eyeBtn = screen.getByTitle("2 spectators");
    expect(eyeBtn).toBeInTheDocument();
    expect(eyeBtn).toHaveTextContent("2");
  });
});
