import React, { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import type { AuthResponse, PlayerColor, Position } from "@shared";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Navbar } from "@/components/Navbar";
import { TiaoBoard } from "@/components/game/TiaoBoard";
import {
  GamePanelBrand,
  AnimatedScoreTile,
  formatPlayerColor,
  HourglassSpinner,
  RoomCodeCopyPill,
  ShareLinkCopyPill,
  PlayerOverviewAvatar,
  EmptySeatAvatar,
  formatPlayerName,
} from "@/components/game/GameShared";
import { useMultiplayerGame } from "@/lib/hooks/useMultiplayerGame";
import { useSocialData } from "@/lib/hooks/useSocialData";
import { useLobbyMessage } from "@/lib/LobbySocketContext";
import { useStonePlacementSound } from "@/lib/useStonePlacementSound";
import { useWinConfetti } from "@/lib/useWinConfetti";
import {
  isGameOver,
  getWinner,
  getJumpTargets,
  arePositionsEqual,
  replayToMove,
} from "@shared";
import { MoveList, MoveListNavButtons } from "@/components/game/MoveList";
import { useGameClock, useFirstMoveCountdown, InlineClockBadge, formatClockTime } from "@/components/game/GameClock";
import { cn } from "@/lib/utils";
import { accessMultiplayerGame } from "@/lib/api";

type MultiplayerGamePageProps = {
  auth: AuthResponse | null;
  onOpenAuth: (mode: "login" | "signup") => void;
  onLogout: () => void;
};

export function MultiplayerGamePage({
  auth,
  onOpenAuth,
  onLogout,
}: MultiplayerGamePageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { gameId } = useParams<{ gameId: string }>();
  const [navOpen, setNavOpen] = useState(false);

  const websocketDebugEnabled = new URLSearchParams(location.search).has(
    "wsDebug",
  );

  const multi = useMultiplayerGame(auth, gameId ?? null, {
    websocketDebugEnabled,
    onRematchStarted: (newGameId) => {
      navigate(`/game/${newGameId}`, { replace: true });
    },
    onGameAborted: (info) => {
      if (info.requeuedForMatchmaking && info.timeControl) {
        toast.info(info.reason);
        navigate("/matchmaking", {
          replace: true,
          state: { timeControl: info.timeControl },
        });
      } else {
        toast.error(info.reason);
        navigate("/", { replace: true });
      }
    },
  });

  const {
    multiplayerSnapshot,
    multiplayerSelection,
    connectionState,
    connectToRoom,
    sendMultiplayerMessage,
    setMultiplayerSelection,
    multiplayerBusy,
    setMultiplayerBusy,
  } = multi;

  const social = useSocialData(auth, false);
  const liveSocialOverview = social.socialOverview;

  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [forfeitDialogOpen, setForfeitDialogOpen] = useState(false);
  const [inviteBusy, setInviteBusy] = useState<string | null>(null);

  // Real-time social updates (friend online status, invitation state)
  useLobbyMessage((payload) => {
    if (payload.type === "social-update") {
      void social.refreshSocialOverview({ silent: true });
    }
  });

  async function handleInviteFriend(friendId: string) {
    if (!gameId) return;
    setInviteBusy(friendId);
    try {
      await social.handleSendGameInvitation(gameId, friendId, 60);
      toast.success("Invitation sent!");
    } catch {
      // handleSendGameInvitation already toasts errors
    } finally {
      setInviteBusy(null);
    }
  }

  useEffect(() => {
    if (!auth || !gameId) return;

    let cancelled = false;
    async function loadGame() {
      setMultiplayerBusy(true);
      try {
        const response = await accessMultiplayerGame(gameId);
        if (!cancelled) {
          connectToRoom(response.snapshot);
        }
      } catch (error) {
        if (!cancelled) {
          toast.error("Failed to load game");
          navigate("/");
        }
      } finally {
        if (!cancelled) setMultiplayerBusy(false);
      }
    }

    if (connectionState === "idle") {
      void loadGame();
    }

    return () => {
      cancelled = true;
    };
  }, [
    auth,
    gameId,
    connectionState,
    connectToRoom,
    navigate,
    setMultiplayerBusy,
  ]);

  useStonePlacementSound(multiplayerSnapshot?.state ?? null);
  const winner = multiplayerSnapshot
    ? isGameOver(multiplayerSnapshot.state)
      ? getWinner(multiplayerSnapshot.state)
      : null
    : null;
  const isReviewMode = multiplayerSnapshot?.status === "finished";

  // Track whether the game was already finished when first loaded (true review mode).
  // If it ends while we're watching, confetti should still fire.
  const wasFinishedOnLoadRef = useRef<boolean | null>(null);
  if (wasFinishedOnLoadRef.current === null && multiplayerSnapshot) {
    wasFinishedOnLoadRef.current = multiplayerSnapshot.status === "finished";
  }

  const [reviewMoveIndex, setReviewMoveIndex] = useState<number | null>(null);

  // Initialize review index when entering review mode
  useEffect(() => {
    if (isReviewMode && multiplayerSnapshot && reviewMoveIndex === null) {
      setReviewMoveIndex(multiplayerSnapshot.state.history.length - 1);
    }
    if (!isReviewMode && reviewMoveIndex !== null) {
      setReviewMoveIndex(null);
    }
  }, [isReviewMode, multiplayerSnapshot, reviewMoveIndex]);

  const reviewBoardState =
    isReviewMode && multiplayerSnapshot && reviewMoveIndex !== null
      ? replayToMove(multiplayerSnapshot.state.history, reviewMoveIndex)
      : null;

  const displayState = reviewBoardState ?? multiplayerSnapshot?.state ?? null;

  const reviewLastMove =
    isReviewMode && multiplayerSnapshot && reviewMoveIndex !== null && reviewMoveIndex >= 0
      ? multiplayerSnapshot.state.history[reviewMoveIndex] ?? null
      : null;

  const playerSeat =
    multiplayerSnapshot && auth
      ? (Object.entries(multiplayerSnapshot.seats).find(
          ([, seat]) => seat?.player.playerId === auth.player.playerId,
        )?.[0] as PlayerColor | undefined)
      : null;

  useWinConfetti(wasFinishedOnLoadRef.current ? null : winner, { viewerColor: playerSeat ?? null });

  const [gameOverDialogOpen, setGameOverDialogOpen] = useState(false);
  const prevWinnerRef = useRef<string | null>(null);

  useEffect(() => {
    if (winner && prevWinnerRef.current !== winner && !wasFinishedOnLoadRef.current) {
      prevWinnerRef.current = winner;
      const id = setTimeout(() => setGameOverDialogOpen(true), 600);
      return () => clearTimeout(id);
    }
    if (!winner) {
      prevWinnerRef.current = null;
      setGameOverDialogOpen(false);
    }
  }, [winner]);

  const playerWon = playerSeat !== null && winner === playerSeat;
  const playerLost = playerSeat !== null && winner !== null && winner !== playerSeat;
  const gameOverTitle = playerWon
    ? "You won!"
    : playerLost
      ? "You lost!"
      : winner
        ? `${formatPlayerColor(winner)} wins!`
        : "";
  const gameOverDescription = playerWon
    ? "Great game! Ready for another round?"
    : playerLost
      ? "Better luck next time. Want to try again?"
      : "The game is over.";

  const { whiteTime, blackTime } = useGameClock(
    multiplayerSnapshot?.clock ?? null,
    multiplayerSnapshot?.state.currentTurn ?? "white",
    multiplayerSnapshot?.status ?? "waiting",
  );
  const yourClockMs = playerSeat ? (playerSeat === "white" ? whiteTime : blackTime) : null;
  const activeClockMs = multiplayerSnapshot?.state.currentTurn === "white" ? whiteTime : blackTime;
  const hasClock = !!multiplayerSnapshot?.timeControl;

  const firstMoveCountdownMs = useFirstMoveCountdown(
    multiplayerSnapshot?.firstMoveDeadline ?? null,
    multiplayerSnapshot?.status ?? "waiting",
  );
  const isAwaitingFirstMove = firstMoveCountdownMs !== null && firstMoveCountdownMs > 0;

  const isMultiplayerParticipant = !!playerSeat;

  // Toast for incoming takeback requests
  const lastTakebackToastRef = useRef<string | null>(null);
  useEffect(() => {
    const takebackRequester = multiplayerSnapshot?.takeback?.requestedBy;
    if (
      takebackRequester &&
      takebackRequester !== playerSeat &&
      lastTakebackToastRef.current !== takebackRequester
    ) {
      lastTakebackToastRef.current = takebackRequester;
      toast("Opponent requested a takeback", {
        action: {
          label: "Accept",
          onClick: () => sendMultiplayerMessage({ type: "accept-takeback" }),
        },
        cancel: {
          label: "Decline",
          onClick: () => sendMultiplayerMessage({ type: "decline-takeback" }),
        },
        duration: Infinity,
      });
    }
    if (!takebackRequester) {
      lastTakebackToastRef.current = null;
    }
  }, [multiplayerSnapshot?.takeback?.requestedBy, playerSeat]);

  // Toast for incoming rematch requests
  const lastRematchToastRef = useRef(false);
  useEffect(() => {
    const rematchRequesters = multiplayerSnapshot?.rematch?.requestedBy ?? [];
    const opponentRequested = rematchRequesters.some((color) => color !== playerSeat);
    const weAlreadyRequested = playerSeat ? rematchRequesters.includes(playerSeat) : false;

    if (opponentRequested && !weAlreadyRequested && !lastRematchToastRef.current) {
      lastRematchToastRef.current = true;
      toast("Opponent wants a rematch!", {
        action: {
          label: "Accept",
          onClick: () => sendMultiplayerMessage({ type: "request-rematch" }),
        },
        cancel: {
          label: "Decline",
          onClick: () => sendMultiplayerMessage({ type: "decline-rematch" }),
        },
        duration: Infinity,
      });
    }
    if (!opponentRequested) {
      if (lastRematchToastRef.current) {
        toast.dismiss();
      }
      lastRematchToastRef.current = false;
    }
  }, [multiplayerSnapshot?.rematch?.requestedBy, playerSeat, sendMultiplayerMessage]);

  // Cancel our outgoing rematch request when navigating away or unmounting
  const weRequestedRematchRef = useRef(false);
  useEffect(() => {
    weRequestedRematchRef.current = !!(
      playerSeat &&
      multiplayerSnapshot?.status === "finished" &&
      multiplayerSnapshot.rematch?.requestedBy.includes(playerSeat as PlayerColor)
    );
  }, [multiplayerSnapshot?.rematch?.requestedBy, multiplayerSnapshot?.status, playerSeat]);

  useEffect(() => {
    return () => {
      if (weRequestedRematchRef.current) {
        sendMultiplayerMessage({ type: "cancel-rematch" });
      }
    };
  }, [sendMultiplayerMessage]);

  const multiplayerYourTurn =
    multiplayerSnapshot?.status === "active" &&
    !!playerSeat &&
    multiplayerSnapshot.state.currentTurn === playerSeat;

  const multiplayerWaitingOnOpponent =
    multiplayerSnapshot?.status === "active" &&
    !!playerSeat &&
    multiplayerSnapshot.state.currentTurn !== playerSeat;

  const multiplayerStatusTitle = !multiplayerSnapshot
    ? "Game"
    : winner
      ? `${formatPlayerColor(winner)} wins`
      : multiplayerSnapshot.status === "waiting"
        ? "Waiting for player two"
        : multiplayerYourTurn
          ? "Your move"
          : "Waiting for opponent";

  const [copyFeedbackKey, setCopyFeedbackKey] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  async function handleCopyGameId() {
    if (!multiplayerSnapshot) return;
    try {
      await navigator.clipboard.writeText(multiplayerSnapshot.gameId);
      setCopyFeedback("Copied!");
      setCopyFeedbackKey("game-id");
      toast.success(`Copied Game ID ${multiplayerSnapshot.gameId}`);
      setTimeout(() => {
        setCopyFeedback(null);
        setCopyFeedbackKey(null);
      }, 2000);
    } catch {
      toast.error("Failed to copy");
    }
  }

  async function handleCopyGameLink() {
    if (!multiplayerSnapshot) return;
    try {
      const url = `${window.location.origin}/game/${multiplayerSnapshot.gameId}`;
      await navigator.clipboard.writeText(url);
      setCopyFeedback("Link copied!");
      setCopyFeedbackKey("share-link");
      toast.success("Copied Share Link");
      setTimeout(() => {
        setCopyFeedback(null);
        setCopyFeedbackKey(null);
      }, 2000);
    } catch {
      toast.error("Failed to copy");
    }
  }

  const multiplayerJumpTargets =
    multiplayerSelection && displayState && !isReviewMode
      ? getJumpTargets(
          displayState,
          multiplayerSelection,
          displayState.currentTurn,
        )
      : [];

  const handleBoardClick = (position: Position) => {
    if (!multiplayerSnapshot || !playerSeat || !multiplayerYourTurn) return;

    const state = multiplayerSnapshot.state;
    const tile = state.positions[position.y][position.x];
    const activeOrigin = multiplayerSelection;
    const jumpTargets = activeOrigin
      ? getJumpTargets(state, activeOrigin, state.currentTurn)
      : [];

    if (activeOrigin && arePositionsEqual(activeOrigin, position)) {
      if (state.pendingJump.length > 0) {
        sendMultiplayerMessage({ type: "confirm-jump" });
        setMultiplayerSelection(null);
      } else {
        setMultiplayerSelection(null);
      }
      return;
    }

    if (
      activeOrigin &&
      jumpTargets.some((t) => arePositionsEqual(t, position))
    ) {
      sendMultiplayerMessage({
        type: "jump-piece",
        from: activeOrigin,
        to: position,
      });
      setMultiplayerSelection(position);
      return;
    }

    if (tile === playerSeat) {
      setMultiplayerSelection(position);
      return;
    }

    if (tile === null && !activeOrigin) {
      sendMultiplayerMessage({ type: "place-piece", position });
      setMultiplayerSelection(null);
      return;
    }

    setMultiplayerSelection(null);
  };

  const paperCard =
    "border-[#d0bb94]/75 bg-[linear-gradient(180deg,rgba(255,250,242,0.96),rgba(244,231,207,0.94))]";

  const boardWrapStyle = {
    maxWidth: "min(100%, calc(100dvh - 5rem))",
    aspectRatio: "1/1",
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[18rem] bg-[radial-gradient(circle_at_top,_rgba(255,247,231,0.76),_transparent_58%)]" />

      <Navbar
        mode="multiplayer"
        auth={auth}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen((v) => !v)}
        onCloseNav={() => setNavOpen(false)}
        onOpenAuth={onOpenAuth}
        onLogout={onLogout}
      />

      <main className="mx-auto flex max-w-[104rem] flex-col gap-5 px-4 pb-3 pt-16 sm:px-6 sm:pt-5 lg:px-6 lg:pb-4 xl:pt-2">
        <section className="grid gap-3 xl:gap-1.5 xl:grid-cols-[minmax(0,1fr)_17.75rem] xl:items-start">
          <div className="flex items-center justify-center xl:min-h-[calc(100dvh-1.5rem)]">
            <div className="relative mx-auto w-full" style={boardWrapStyle}>
              {displayState && (
                <TiaoBoard
                  state={displayState}
                  selectedPiece={isReviewMode ? null : multiplayerSelection}
                  jumpTargets={multiplayerJumpTargets}
                  confirmReady={true}
                  lastMove={reviewLastMove}
                  onPointClick={isReviewMode ? undefined : handleBoardClick}
                  disabled={isReviewMode || !multiplayerYourTurn}
                  onUndoLastJump={
                    isReviewMode
                      ? undefined
                      : () =>
                          sendMultiplayerMessage({
                            type: "undo-pending-jump-step",
                          })
                  }
                />
              )}
              {/* Review nav buttons moved to card header pill area */}
              {multiplayerSnapshot?.status === "waiting" && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="flex items-center gap-3 rounded-3xl border border-[#dcc7a2] bg-[#fff7ec]/92 px-5 py-3 text-sm font-semibold text-[#5d4732] shadow-lg backdrop-blur">
                    <HourglassSpinner className="text-[#7b5f3f]" />
                    Waiting For Opponent...
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4 xl:max-h-[calc(100dvh-1.5rem)] xl:overflow-auto">
            <div className="mx-auto w-full xl:mx-0" style={boardWrapStyle}>
              <Card
                className={cn(
                  paperCard,
                  multiplayerYourTurn &&
                    "border-[#b7cb8d] bg-[linear-gradient(180deg,rgba(251,255,243,0.98),rgba(240,248,224,0.96))]",
                )}
              >
                <CardHeader className="gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <GamePanelBrand />
                      <Badge className="w-fit bg-[#eee3cf] text-[#5f4932] mt-1">
                        Multiplayer
                      </Badge>
                    </div>
                    <div className="flex shrink-0 justify-end">
                      {isReviewMode && multiplayerSnapshot && reviewMoveIndex !== null ? (
                        <motion.div
                          initial={{ opacity: 0, y: -8, scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          className="flex items-center rounded-full border border-[#d8c29c] bg-[#fff8ee]/96 px-1 py-1 shadow-[0_16px_28px_-22px_rgba(67,45,24,0.5)] backdrop-blur"
                          data-testid="review-nav-buttons"
                        >
                          <MoveListNavButtons
                            history={multiplayerSnapshot.state.history}
                            currentMoveIndex={reviewMoveIndex}
                            onSelectMove={setReviewMoveIndex}
                          />
                        </motion.div>
                      ) : multiplayerSnapshot &&
                      connectionState !== "connected" ? (
                        <motion.div
                          initial={{ opacity: 0, y: -8, scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          className="flex items-center gap-2 rounded-full border border-[#d8c29c] bg-[#fff8ee]/96 px-3 py-2 text-sm font-semibold text-[#5d4732] shadow-[0_16px_28px_-22px_rgba(67,45,24,0.5)] backdrop-blur"
                        >
                          <HourglassSpinner className="text-[#7b5f3f]" />
                          {connectionState === "connecting"
                            ? "Connecting"
                            : "Reconnecting"}
                        </motion.div>
                      ) : isAwaitingFirstMove && multiplayerYourTurn ? (
                        <motion.div
                          initial={{ opacity: 0, y: -8, scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          className="flex items-center gap-2 rounded-full border border-[#c9a84c] bg-[#fffbeb]/96 px-3 py-2 text-sm font-semibold text-[#8b6914] shadow-[0_16px_28px_-22px_rgba(139,105,20,0.42)] backdrop-blur"
                        >
                          <span className="font-mono tabular-nums text-base">{formatClockTime(firstMoveCountdownMs)}</span>
                          <span>to make first move</span>
                        </motion.div>
                      ) : isAwaitingFirstMove && multiplayerWaitingOnOpponent ? (
                        <motion.div
                          initial={{ opacity: 0, y: -8, scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          className="flex items-center gap-2 rounded-full border border-[#d8c29c] bg-[#fff8ee]/96 px-3 py-2 text-sm font-semibold text-[#5d4732] shadow-[0_16px_28px_-22px_rgba(67,45,24,0.5)] backdrop-blur"
                        >
                          <HourglassSpinner className="text-[#7b5f3f]" />
                          <span className="font-mono tabular-nums">{formatClockTime(firstMoveCountdownMs)}</span>
                          <span>Opponent&apos;s first move</span>
                        </motion.div>
                      ) : multiplayerYourTurn ? (
                        <div className="flex items-center gap-2">
                          {hasClock && (
                            <InlineClockBadge timeMs={activeClockMs} className="ml-0 text-base" />
                          )}
                          <motion.div
                            initial={{ opacity: 0, y: -8, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            className="flex items-center rounded-full border border-[#b8cc8f] bg-[#f7fce9]/96 px-3 py-2 text-sm font-semibold text-[#56703f] shadow-[0_16px_28px_-22px_rgba(63,92,32,0.42)] backdrop-blur"
                          >
                            Your move
                          </motion.div>
                        </div>
                      ) : multiplayerWaitingOnOpponent ? (
                        <div className="flex items-center gap-2">
                          {hasClock && (
                            <InlineClockBadge timeMs={activeClockMs} className="ml-0 text-base" />
                          )}
                          <motion.div
                            initial={{ opacity: 0, y: -8, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            className="flex items-center gap-2 rounded-full border border-[#d8c29c] bg-[#fff8ee]/96 px-3 py-2 text-sm font-semibold text-[#5d4732] shadow-[0_16px_28px_-22px_rgba(67,45,24,0.5)] backdrop-blur"
                          >
                            <HourglassSpinner className="text-[#7b5f3f]" />
                            Waiting For Opponent To Move
                          </motion.div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-end justify-between gap-4 border-t border-black/5 pt-4">
                    <div className="space-y-1">
                      <CardTitle className="font-display text-2xl text-[#2b1e14]">
                        {multiplayerSnapshot?.status === "active"
                          ? "Live match"
                          : multiplayerStatusTitle}
                      </CardTitle>
                    </div>
                    {multiplayerSnapshot && (
                      <div className="flex items-center gap-2">
                        <RoomCodeCopyPill
                          gameId={multiplayerSnapshot.gameId}
                          copied={
                            copyFeedbackKey === "game-id" && !!copyFeedback
                          }
                          onCopy={handleCopyGameId}
                          hideCopyIcon={isReviewMode}
                        />
                        <ShareLinkCopyPill
                          copied={
                            copyFeedbackKey === "share-link" && !!copyFeedback
                          }
                          onCopy={handleCopyGameLink}
                        />
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {multiplayerSnapshot ? (
                    <>
                      {multiplayerSnapshot.status === "waiting" ? (
                        <>
                          <div className="grid grid-cols-2 gap-3">
                            <AnimatedScoreTile
                              label="Black"
                              value={
                                (displayState ?? multiplayerSnapshot.state)
                                  .score.black
                              }
                              pulseKey={0}
                              className="rounded-3xl border border-black/10 bg-[linear-gradient(180deg,#39312b,#14100d)] p-4 text-[#f9f2e8]"
                              labelClassName="text-xs uppercase tracking-wider"
                            />
                            <AnimatedScoreTile
                              label="White"
                              value={
                                (displayState ?? multiplayerSnapshot.state)
                                  .score.white
                              }
                              pulseKey={0}
                              className="rounded-3xl border border-[#d3c3ad] bg-[linear-gradient(180deg,#fffef8,#efe4d1)] p-4 text-[#2b1e14]"
                              labelClassName="text-xs uppercase tracking-wider"
                            />
                          </div>
                          <div className="space-y-2">
                            {Array.from({ length: 2 }, (_, index) => {
                              const slot =
                                multiplayerSnapshot.players[index] ?? null;
                              return (
                                <div
                                  key={`lobby-player-${index}`}
                                  className="flex items-center justify-between gap-3 rounded-3xl border border-[#d8c29c] bg-[#fffaf1] px-4 py-3"
                                >
                                  <div className="flex items-center gap-3">
                                    {slot ? (
                                      <PlayerOverviewAvatar
                                        player={slot.player}
                                      />
                                    ) : (
                                      <EmptySeatAvatar />
                                    )}
                                    <div>
                                      <p className="text-sm font-semibold text-[#2b1e14]">
                                        {index === 0
                                          ? "Lobby host"
                                          : "Second player"}
                                      </p>
                                      <p className="text-sm text-[#7a6656]">
                                        {slot
                                          ? formatPlayerName(
                                              slot.player,
                                              auth?.player.playerId,
                                            )
                                          : "Waiting to join"}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {!slot &&
                                      auth?.player.kind === "account" &&
                                      isMultiplayerParticipant && (
                                        <Button
                                          size="sm"
                                          variant="secondary"
                                          className="text-xs border-[#dcc7a2]"
                                          onClick={() =>
                                            setInviteDialogOpen(true)
                                          }
                                        >
                                          Invite a Friend
                                        </Button>
                                      )}
                                    <Badge
                                      className={cn(
                                        slot?.online
                                          ? "bg-[#eef2e8] text-[#43513f]"
                                          : "bg-[#f2e8d9] text-[#6e5b48]",
                                      )}
                                    >
                                      {slot?.online ? "Online" : "Offline"}
                                    </Badge>
                                  </div>
                                </div>
                              );
                            })}
                            <p className="mt-4 text-xs leading-relaxed text-[#7a6656]">
                              Share the Game ID or use the share link above to
                              invite a friend. White still starts. The colors are
                              assigned randomly the moment player two joins the
                              lobby.
                            </p>
                          </div>
                        </>
                      ) : (
                        <div className="grid grid-cols-2 gap-3">
                          {(["black", "white"] as PlayerColor[]).map(
                            (color) => {
                              const seat = multiplayerSnapshot.seats[color];
                              const isYourSeat =
                                seat?.player.playerId === auth?.player.playerId;
                              const isAccount = auth?.player.kind === "account";
                              const opponentId = seat?.player.playerId;

                              const isFriend =
                                !isYourSeat && opponentId
                                  ? liveSocialOverview.friends.some(
                                      (f) => f.playerId === opponentId,
                                    )
                                  : false;
                              const hasPendingOutgoing =
                                !isYourSeat && opponentId
                                  ? liveSocialOverview.outgoingFriendRequests.some(
                                      (f) => f.playerId === opponentId,
                                    )
                                  : false;
                              const hasPendingIncoming =
                                !isYourSeat && opponentId
                                  ? liveSocialOverview.incomingFriendRequests.some(
                                      (f) => f.playerId === opponentId,
                                    )
                                  : false;
                              const canBefriend =
                                isAccount &&
                                !isYourSeat &&
                                seat &&
                                seat.player.kind === "account" &&
                                !isFriend &&
                                !hasPendingOutgoing &&
                                !hasPendingIncoming;

                              const tileVariant =
                                color === "black" ? "dark" : "light";
                              const tileStyle =
                                color === "black"
                                  ? "rounded-3xl border border-black/10 bg-[linear-gradient(180deg,#39312b,#14100d)] p-4 text-[#f9f2e8]"
                                  : "rounded-3xl border border-[#d3c3ad] bg-[linear-gradient(180deg,#fffef8,#efe4d1)] p-4 text-[#2b1e14]";

                              return (
                                <AnimatedScoreTile
                                  key={color}
                                  label={
                                    color.charAt(0).toUpperCase() +
                                    color.slice(1)
                                  }
                                  value={
                                    (displayState ?? multiplayerSnapshot.state)
                                      .score[color]
                                  }
                                  pulseKey={0}
                                  className={tileStyle}
                                  labelClassName="text-xs uppercase tracking-wider"
                                  clockMs={hasClock ? (color === "white" ? whiteTime : blackTime) : null}
                                  clockActive={hasClock && multiplayerSnapshot.state.currentTurn === color && multiplayerSnapshot.status === "active"}
                                  playerInfo={
                                    seat
                                      ? {
                                          player: seat.player,
                                          online: seat.online,
                                          isYou: isYourSeat,
                                          isFriend,
                                          hasPendingOutgoing,
                                          canBefriend,
                                          variant: tileVariant,
                                          onAddFriend: canBefriend
                                            ? () =>
                                                social.handleSendFriendRequest(
                                                  seat.player.playerId,
                                                )
                                            : undefined,
                                          addFriendBusy:
                                            social.socialActionBusyKey ===
                                            `friend-send:${seat.player.playerId}`,
                                          onCancelFriendRequest:
                                            hasPendingOutgoing
                                              ? () =>
                                                  social.handleCancelFriendRequest(
                                                    seat.player.playerId,
                                                  )
                                              : undefined,
                                          cancelFriendRequestBusy:
                                            social.socialActionBusyKey ===
                                            `friend-cancel:${seat.player.playerId}`,
                                        }
                                      : undefined
                                  }
                                />
                              );
                            },
                          )}
                        </div>
                      )}

                      {multiplayerSnapshot.status === "active" &&
                        isMultiplayerParticipant &&
                        connectionState === "connected" && (
                          <div className="border-t border-[#dbc6a2] pt-3">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="w-full text-[#9b4030] hover:bg-[#fdf0ed] hover:text-[#7a2e22]"
                              onClick={() => setForfeitDialogOpen(true)}
                            >
                              Forfeit
                            </Button>
                          </div>
                        )}

                      {/* Takeback controls */}
                      {multiplayerSnapshot.status === "active" &&
                        isMultiplayerParticipant &&
                        !winner && (
                          <div className="grid gap-2">
                            {multiplayerSnapshot.takeback?.requestedBy &&
                            multiplayerSnapshot.takeback.requestedBy !== playerSeat ? (
                              <div className="rounded-2xl border border-[#d8c29c] bg-[#fff8ee] p-3 space-y-2">
                                <p className="text-sm font-semibold text-[#2b1e14]">
                                  Opponent requested a takeback
                                </p>
                                <div className="grid grid-cols-2 gap-2">
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() =>
                                      sendMultiplayerMessage({
                                        type: "accept-takeback",
                                      })
                                    }
                                  >
                                    Accept
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      sendMultiplayerMessage({
                                        type: "decline-takeback",
                                      })
                                    }
                                  >
                                    Decline
                                  </Button>
                                </div>
                              </div>
                            ) : multiplayerSnapshot.takeback?.requestedBy === playerSeat ? (
                              <div className="flex items-center gap-2 rounded-2xl border border-[#d8c29c] bg-[#fff8ee] px-4 py-3">
                                <HourglassSpinner className="text-[#7b5f3f]" />
                                <p className="text-sm font-medium text-[#5d4732]">
                                  Takeback requested...
                                </p>
                              </div>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  sendMultiplayerMessage({
                                    type: "request-takeback",
                                  })
                                }
                                disabled={
                                  multiplayerSnapshot.state.history.length === 0 ||
                                  (multiplayerSnapshot.takeback?.declinedCount?.[playerSeat as PlayerColor] ?? 0) >= 3
                                }
                              >
                                {(multiplayerSnapshot.takeback?.declinedCount?.[playerSeat as PlayerColor] ?? 0) >= 3
                                  ? "No takebacks left"
                                  : "Request Takeback"}
                              </Button>
                            )}
                          </div>
                        )}

                      {winner &&
                        isMultiplayerParticipant &&
                        connectionState === "connected" &&
                        multiplayerSnapshot.seats[playerSeat === "white" ? "black" : "white"]?.online && (
                          <div className="grid gap-2 border-t border-[#dbc6a2] pt-4">
                            {multiplayerSnapshot.rematch?.requestedBy.includes(
                              playerSeat as PlayerColor,
                            ) ? (
                              <div className="space-y-2">
                                <p className="text-center text-sm font-medium text-[#56703f]">
                                  Rematch requested. Waiting for opponent...
                                </p>
                                {(
                                  multiplayerSnapshot.rematch?.requestedBy ?? []
                                ).some((color) => color !== playerSeat) && (
                                  <p className="text-center text-xs text-[#6e5b48]">
                                    Your opponent also wants a rematch! It
                                    should start any second.
                                  </p>
                                )}
                              </div>
                            ) : (
                              <div className="grid grid-cols-2 gap-2">
                                <Button
                                  variant="secondary"
                                  onClick={() => {
                                    sendMultiplayerMessage({
                                      type: "request-rematch",
                                    });
                                    if (!multiplayerSnapshot.rematch?.requestedBy.length) {
                                      toast.success("Rematch request sent!");
                                    }
                                  }}
                                >
                                  {multiplayerSnapshot.rematch?.requestedBy
                                    .length
                                    ? "Accept Rematch"
                                    : "Rematch"}
                                </Button>
                                {(
                                  multiplayerSnapshot.rematch?.requestedBy ?? []
                                ).some((color) => color !== playerSeat) ? (
                                  <Button
                                    variant="outline"
                                    onClick={() =>
                                      sendMultiplayerMessage({
                                        type: "decline-rematch",
                                      })
                                    }
                                  >
                                    Decline
                                  </Button>
                                ) : (
                                  <Button
                                    variant="outline"
                                    onClick={() => navigate("/")}
                                  >
                                    Lobby
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                      {isReviewMode &&
                        !(
                          isMultiplayerParticipant &&
                          connectionState === "connected"
                        ) && (
                          <div className="grid gap-2 border-t border-[#dbc6a2] pt-4">
                            <Button
                              variant="ghost"
                              onClick={() => navigate("/")}
                            >
                              Back to lobby
                            </Button>
                          </div>
                        )}

                      {multiplayerSnapshot.state.history.length > 0 && (
                        <div className="border-t border-[#dbc6a2] pt-4">
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#7b6550]">
                            Move History
                          </p>
                          <MoveList
                            history={multiplayerSnapshot.state.history}
                            currentMoveIndex={
                              isReviewMode
                                ? reviewMoveIndex
                                : multiplayerSnapshot.state.history.length - 1
                            }
                            onSelectMove={
                              isReviewMode ? setReviewMoveIndex : undefined
                            }
                            interactive={isReviewMode}
                            hideNavButtons={isReviewMode}
                          />
                        </div>
                      )}

                      {multiplayerSnapshot.players.length > 2 && (
                        <div className="space-y-2 border-t border-black/5 pt-4">
                          <p className="text-xs font-semibold uppercase tracking-wider text-[#7b6550]">
                            Spectators
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {multiplayerSnapshot.players
                              .slice(2)
                              .map((slot) => (
                                <div
                                  key={slot.player.playerId}
                                  title={slot.player.displayName}
                                >
                                  <PlayerOverviewAvatar
                                    player={slot.player}
                                    className="h-6 w-6"
                                  />
                                </div>
                              ))}
                          </div>
                        </div>
                      )}
                    </>
                  ) : multiplayerBusy ? (
                    <div className="flex flex-col items-center py-12 gap-3">
                      <HourglassSpinner className="h-8 w-8 text-[#a6824d]" />
                      <p className="text-sm text-[#6e5b48]">Loading match...</p>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          </div>
        </section>
      </main>

      <Dialog
        open={inviteDialogOpen}
        onOpenChange={setInviteDialogOpen}
        title="Invite a Friend"
        description="Choose a friend to invite to this game."
      >
        <div className="space-y-2 max-h-[20rem] overflow-y-auto">
          {liveSocialOverview.friends.length === 0 ? (
            <p className="text-center text-sm text-[#6e5b48] py-6">
              No friends yet. Add friends from the Friends page.
            </p>
          ) : (
            liveSocialOverview.friends.map((friend) => {
              const alreadyInRoom = multiplayerSnapshot?.players.some(
                (slot) => slot.player.playerId === friend.playerId,
              );
              const alreadyInvited =
                liveSocialOverview.outgoingInvitations.some(
                  (inv) =>
                    inv.recipient.playerId === friend.playerId &&
                    inv.gameId === gameId,
                );
              return (
                <div
                  key={friend.playerId}
                  className="flex items-center justify-between rounded-2xl border border-[#d8c29c] bg-[#fffaf1] px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <PlayerOverviewAvatar player={friend} />
                    <span className="text-sm font-semibold text-[#2b1e14]">
                      {friend.displayName}
                    </span>
                    <Badge
                      className={cn(
                        "text-xs",
                        friend.online
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-gray-100 text-gray-500",
                      )}
                    >
                      {friend.online ? "Online" : "Offline"}
                    </Badge>
                  </div>
                  {alreadyInRoom ? (
                    <Badge variant="outline" className="text-xs text-[#43513f]">
                      In game
                    </Badge>
                  ) : alreadyInvited ? (
                    <Badge variant="outline" className="text-xs text-[#8d7760]">
                      Invited
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      className="text-xs"
                      onClick={() => handleInviteFriend(friend.playerId)}
                      disabled={inviteBusy === friend.playerId}
                    >
                      {inviteBusy === friend.playerId ? "Sending..." : "Invite"}
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </Dialog>

      <Dialog
        open={forfeitDialogOpen}
        onOpenChange={setForfeitDialogOpen}
        title="Forfeit Game"
        description="Are you sure you want to forfeit? Your opponent will win."
      >
        <div className="flex gap-3 justify-end">
          <Button
            variant="outline"
            onClick={() => setForfeitDialogOpen(false)}
          >
            Cancel
          </Button>
          <Button
            className="bg-[#9b4030] text-white hover:bg-[#7a2e22]"
            onClick={() => {
              setForfeitDialogOpen(false);
              sendMultiplayerMessage({ type: "forfeit" });
            }}
          >
            Forfeit
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={gameOverDialogOpen}
        onOpenChange={setGameOverDialogOpen}
        title={gameOverTitle}
        description={gameOverDescription}
      >
        <div className="grid gap-2">
          {isMultiplayerParticipant &&
            connectionState === "connected" &&
            multiplayerSnapshot?.seats[playerSeat === "white" ? "black" : "white"]?.online ? (
            <>
              {multiplayerSnapshot?.rematch?.requestedBy.includes(playerSeat as PlayerColor) ? (
                <p className="text-center text-sm font-medium text-[#56703f] py-2">
                  Rematch requested. Waiting for opponent...
                </p>
              ) : (
                <Button
                  onClick={() => {
                    sendMultiplayerMessage({ type: "request-rematch" });
                    if (!multiplayerSnapshot?.rematch?.requestedBy.length) {
                      toast.success("Rematch request sent!");
                    }
                    setGameOverDialogOpen(false);
                  }}
                >
                  {multiplayerSnapshot?.rematch?.requestedBy.length
                    ? "Accept Rematch"
                    : "Rematch"}
                </Button>
              )}
            </>
          ) : null}
          <Button variant="ghost" onClick={() => { setGameOverDialogOpen(false); navigate("/"); }}>
            Back to lobby
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
