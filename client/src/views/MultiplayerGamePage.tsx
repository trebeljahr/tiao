"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { toast } from "sonner";
import type { PlayerColor, Position } from "@shared";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PaperCard } from "@/components/ui/paper-card";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Navbar } from "@/components/Navbar";
import { TiaoBoard } from "@/components/game/TiaoBoard";
import {
  GamePanelBrand,
  AnimatedScoreTile,
  translatePlayerColor,
  HourglassSpinner,
  RoomCodeCopyPill,
  ShareLinkCopyPill,
  SpectateButton,
  EmptySeatAvatar,
} from "@/components/game/GameShared";
import { useMultiplayerGame } from "@/lib/hooks/useMultiplayerGame";
import { useSocialData } from "@/lib/hooks/useSocialData";
import { useLobbyMessage } from "@/lib/LobbySocketContext";
import { useStonePlacementSound } from "@/lib/useStonePlacementSound";
import { TournamentContextBar } from "@/components/tournament/TournamentContextBar";
import confetti from "canvas-confetti";
import { PlayerIdentityRow } from "@/components/PlayerIdentityRow";
import {
  isGameOver,
  getWinner,
  getFinishReason,
  getJumpTargets,
  arePositionsEqual,
  replayToMove,
  isBoardMove,
  formatGameNotation,
} from "@shared";
import type { FinishReason } from "@shared";
import { MoveList, MoveListNavButtons } from "@/components/game/MoveList";
import {
  useGameClock,
  useFirstMoveCountdown,
  InlineClockBadge,
  formatClockTime,
} from "@/components/game/GameClock";
import { cn } from "@/lib/utils";
import { accessMultiplayerGame, getMultiplayerGame } from "@/lib/api";
import { InviteFriendsModal } from "@/components/InviteFriendsModal";
import { LoadingBoardSkeleton } from "@/components/game/LoadingBoardSkeleton";

function AnimatedEllipsis() {
  const [dots, setDots] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setDots((d) => (d + 1) % 4), 500);
    return () => clearInterval(interval);
  }, []);
  return <span className="inline-block w-[1.5em] text-left">{".".repeat(dots)}</span>;
}

/** Counting-up animation from `before` to `after` with a bounce at the end. */
function AnimatedRatingChange({
  label,
  before,
  after,
  delta,
}: {
  label: string;
  before: number;
  after: number;
  delta: number;
}) {
  const [displayValue, setDisplayValue] = useState(Math.round(before));
  const [animDone, setAnimDone] = useState(false);

  useEffect(() => {
    const start = Math.round(before);
    const end = Math.round(after);
    if (start === end) {
      setDisplayValue(end);
      setAnimDone(true);
      return;
    }

    const totalSteps = Math.min(Math.abs(end - start), 30);
    const duration = 800; // ms
    const stepDuration = duration / totalSteps;
    let step = 0;

    const timer = setInterval(() => {
      step++;
      // Ease-out: start fast, slow down at end
      const progress = step / totalSteps;
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(start + (end - start) * eased);
      setDisplayValue(current);

      if (step >= totalSteps) {
        clearInterval(timer);
        setDisplayValue(end);
        setAnimDone(true);
      }
    }, stepDuration);

    return () => clearInterval(timer);
  }, [before, after]);

  const roundedDelta = Math.round(delta);

  return (
    <div className="flex items-center justify-start gap-3 py-2 mb-2">
      <span className="text-sm text-[#6e5b48]">{label}:</span>
      <motion.span
        className="font-display text-2xl font-bold text-[#2b1e14]"
        animate={animDone ? { scale: [1.15, 1] } : {}}
        transition={{ type: "spring", stiffness: 400, damping: 10 }}
      >
        {displayValue}
      </motion.span>
      {roundedDelta !== 0 && (
        <motion.span
          initial={{ opacity: 0, scale: 0.5 }}
          animate={animDone ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.5 }}
          transition={{ type: "spring", stiffness: 300, damping: 15 }}
          className={cn(
            "inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-bold",
            roundedDelta > 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600",
          )}
        >
          {roundedDelta > 0 ? "+" : ""}
          {roundedDelta}
        </motion.span>
      )}
    </div>
  );
}

export function MultiplayerGamePage() {
  const t = useTranslations("game");
  const tCommon = useTranslations("common");
  const { auth, onOpenAuth, onLogout } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams<{ gameId: string }>();
  const gameId = params?.gameId;
  const [navOpen, setNavOpen] = useState(false);

  const websocketDebugEnabled = searchParams?.has("wsDebug") ?? false;
  const spectateOnly = searchParams?.has("spectate") ?? false;

  const multi = useMultiplayerGame(auth, gameId ?? null, {
    websocketDebugEnabled,
    spectateOnly,
    onRematchStarted: (newGameId) => {
      router.replace(`/game/${newGameId}`);
    },
    onGameAborted: (info) => {
      // Localise well-known reasons via stable codes from the server.
      const message = info.code === "ANON_CONFLICT" ? t("anonymousUserLeft") : info.reason;
      if (info.requeuedForMatchmaking && info.timeControl) {
        toast.info(message);
        router.replace(
          `/matchmaking?initial=${info.timeControl.initialMs}&increment=${info.timeControl.incrementMs}`,
        );
      } else {
        toast.error(message);
        router.replace("/");
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
  const [spectatorDialogOpen, setSpectatorDialogOpen] = useState(false);
  const [inviteBusy, setInviteBusy] = useState<string | null>(null);
  const [revokeBusy, setRevokeBusy] = useState<string | null>(null);

  // Introduction modal for new players who haven't completed the tutorial (#25)
  const [rulesIntroOpen, setRulesIntroOpen] = useState(false);
  // Tracks whether the tutorial-check effect has already made its one-time
  // decision for this page mount. Without this guard the effect re-fires when
  // `auth` is replaced by a fresh object reference (social fetch, profile
  // update, etc.) — and on the SECOND run the previous "show modal" decision
  // makes it look like we're done, so it falls through to setReadyToJoin(true)
  // and bypasses the gate while the modal is still open. The result was the
  // join happening immediately and the "Game started!" toast firing on top of
  // the modal.
  const tutorialCheckDoneRef = useRef(false);

  // Gate game join on rules intro dismissal so the player isn't joined before
  // pressing the "I've played before" link or returning from /tutorial (#154)
  const [readyToJoin, setReadyToJoin] = useState(false);

  // Determine immediately whether we need the rules intro or can join right away.
  // This must NOT depend on multiplayerSnapshot (which requires joining first).
  useEffect(() => {
    if (!auth) return;
    // One-shot: once we've decided, do not re-decide on subsequent renders
    // (e.g. when auth gets replaced by a re-fetch) — that path used to fall
    // through to setReadyToJoin(true) and skip the modal entirely.
    if (tutorialCheckDoneRef.current) return;

    // Spectators always join immediately — they just watch, no intro needed
    if (spectateOnly) {
      tutorialCheckDoneRef.current = true;
      setReadyToJoin(true);
      return;
    }

    // The localStorage key is "tiao:knowsHowToPlay" (bumped from the old
    // "tiao:tutorialComplete") so that anyone who casually clicked the previous
    // "Got it, let's play" dismiss button gets re-prompted by the new modal —
    // the new flow forces a deliberate choice between learning and acknowledging
    // prior experience, which prevents the "Game started!" toast from firing
    // for someone who never saw the rules.
    const needsIntro = !auth.player.hasSeenTutorial && !localStorage.getItem("tiao:knowsHowToPlay");

    tutorialCheckDoneRef.current = true;
    if (needsIntro) {
      setRulesIntroOpen(true);
      // readyToJoin stays false until the modal is dismissed
    } else {
      setReadyToJoin(true);
    }
  }, [auth, spectateOnly]);

  // Close invite modal, scroll to board, and notify when both seats are filled.
  // Distinguish three cases on the first snapshot we observe:
  //   - Both seats filled, active, moves already played (history.length > 0)
  //     → "gameResumed" (player is reloading mid-game).
  //   - Both seats filled, active, no moves yet (history.length === 0)
  //     → "gameStarted" (joiner's first arrival to a fresh game — they
  //     never observed the not-both → both transition).
  //   - Otherwise silent; only fire "gameStarted" later when we actually
  //     witness the seat transition during this page lifetime (the creator
  //     watching their opponent join).
  const bothSeated = !!(multiplayerSnapshot?.seats.white && multiplayerSnapshot?.seats.black);
  const prevBothSeatedRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (!multiplayerSnapshot) return;
    const prev = prevBothSeatedRef.current;
    if (prev === null) {
      // First snapshot we've seen — decide between "started", "resumed", or silent.
      // Only toast if the current user is actually one of the seated players
      // (not a spectator) and the game is in progress.
      const isSeatedPlayer = !!(
        auth &&
        (multiplayerSnapshot.seats.white?.player.playerId === auth.player.playerId ||
          multiplayerSnapshot.seats.black?.player.playerId === auth.player.playerId)
      );
      if (bothSeated && multiplayerSnapshot.status === "active" && isSeatedPlayer) {
        if (multiplayerSnapshot.state.history.length > 0) {
          toast(t("gameResumed"));
        } else {
          setInviteDialogOpen(false);
          window.scrollTo({ top: 0, behavior: "smooth" });
          toast(t("gameStarted"));
        }
      }
      prevBothSeatedRef.current = bothSeated;
      return;
    }
    if (bothSeated && !prev) {
      setInviteDialogOpen(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
      toast(t("gameStarted"));
    }
    prevBothSeatedRef.current = bothSeated;
  }, [bothSeated, multiplayerSnapshot, auth, t]);

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
      toast.success(tCommon("invitationSent"));
    } catch {
      // handleSendGameInvitation already toasts errors
    } finally {
      setInviteBusy(null);
    }
  }

  async function handleRevokeInvite(invitationId: string) {
    setRevokeBusy(invitationId);
    try {
      await social.handleRevokeGameInvitation(invitationId);
    } catch {
      // handleRevokeGameInvitation already toasts errors
    } finally {
      setRevokeBusy(null);
    }
  }

  useEffect(() => {
    if (!auth || !gameId || !readyToJoin) return;

    let cancelled = false;
    async function loadGame() {
      setMultiplayerBusy(true);
      try {
        const fetchGame = spectateOnly ? getMultiplayerGame : accessMultiplayerGame;
        const response = await fetchGame(gameId);

        if (!cancelled) {
          connectToRoom(response.snapshot);
        }
      } catch (err) {
        if (!cancelled) {
          if (
            err instanceof Error &&
            "code" in err &&
            (err as { code?: string }).code === "GUEST_CANNOT_JOIN_CUSTOM_GAME"
          ) {
            onOpenAuth("signup", { forced: true });
          } else {
            toast.error(tCommon("failedToLoadGame"));
            router.push("/");
          }
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
    router,
    setMultiplayerBusy,
    spectateOnly,
    readyToJoin,
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

  // Initialize review index when entering review mode (point to last board move, not meta-events)
  useEffect(() => {
    if (isReviewMode && multiplayerSnapshot && reviewMoveIndex === null) {
      const history = multiplayerSnapshot.state.history;
      let lastBoardIdx = history.length - 1;
      while (lastBoardIdx >= 0 && !isBoardMove(history[lastBoardIdx])) {
        lastBoardIdx--;
      }
      setReviewMoveIndex(lastBoardIdx);
    }
    if (!isReviewMode && reviewMoveIndex !== null) {
      setReviewMoveIndex(null);
    }
  }, [isReviewMode, multiplayerSnapshot, reviewMoveIndex]);

  const reviewBoardState =
    isReviewMode && multiplayerSnapshot && reviewMoveIndex !== null
      ? replayToMove(multiplayerSnapshot.state.history, reviewMoveIndex, {
          boardSize: multiplayerSnapshot.state.boardSize,
          scoreToWin: multiplayerSnapshot.state.scoreToWin,
        })
      : null;

  const displayState = reviewBoardState ?? multiplayerSnapshot?.state ?? null;

  const reviewLastMove = (() => {
    if (isReviewMode && multiplayerSnapshot && reviewMoveIndex !== null) {
      if (reviewMoveIndex < 0) return null;
      const rec = multiplayerSnapshot.state.history[reviewMoveIndex];
      return rec && isBoardMove(rec) ? rec : null;
    }
    // During live play, show the most recent board move
    if (multiplayerSnapshot) {
      const history = multiplayerSnapshot.state.history;
      for (let i = history.length - 1; i >= 0; i--) {
        if (isBoardMove(history[i])) return history[i];
      }
    }
    return null;
  })();

  const playerSeat =
    multiplayerSnapshot && auth
      ? ((Object.entries(multiplayerSnapshot.seats).find(
          ([, seat]) => seat?.player.playerId === auth.player.playerId,
        )?.[0] as PlayerColor | undefined) ?? null)
      : null;

  const [gameOverDialogOpen, setGameOverDialogOpen] = useState(false);
  const prevWinnerRef = useRef<string | null>(null);
  const confettiCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (winner && prevWinnerRef.current !== winner && !wasFinishedOnLoadRef.current) {
      prevWinnerRef.current = winner;
      setGameOverDialogOpen(true);
    }
    if (!winner) {
      prevWinnerRef.current = null;
      setGameOverDialogOpen(false);
    }
  }, [winner]);

  // Fire confetti inside the modal canvas when the dialog opens
  const fireModalConfetti = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (!canvas) return;
      // No confetti for spectators
      if (!playerSeat) return;
      const fire = confetti.create(canvas, { resize: true });
      const playerLost = playerSeat !== null && winner !== null && winner !== playerSeat;

      if (playerLost) {
        // Subtle defeat particles
        const colors = ["#8b7355", "#a69278", "#c4b49a", "#d6cbb8"];
        const duration = 1400;
        const endTime = Date.now() + duration;
        const frame = () => {
          fire({
            particleCount: 2,
            startVelocity: 8,
            spread: 160,
            gravity: 0.35,
            drift: 0.6 + Math.random() * 0.8,
            origin: { x: Math.random(), y: -0.05 },
            colors,
            scalar: 1.2,
            shapes: ["circle"],
            ticks: 300,
          });
          if (Date.now() < endTime) window.requestAnimationFrame(frame);
        };
        frame();
      } else {
        // Victory confetti
        fire({
          particleCount: 100,
          startVelocity: 35,
          spread: 360,
          origin: { x: 0.5, y: 0.4 },
          colors: [
            "#ff6b6b",
            "#feca57",
            "#48dbfb",
            "#ff9ff3",
            "#54a0ff",
            "#5f27cd",
            "#01a3a4",
            "#f368e0",
            "#ff9f43",
            "#00d2d3",
          ],
          scalar: 1.1,
          gravity: 0.6,
          ticks: 180,
          shapes: ["circle", "square"],
        });
      }
    },
    [winner, playerSeat],
  );

  const confettiCanvasCallback = useCallback(
    (node: HTMLCanvasElement | null) => {
      confettiCanvasRef.current = node;
      if (node && !wasFinishedOnLoadRef.current) {
        fireModalConfetti(node);
      }
    },
    [fireModalConfetti],
  );

  const playerWon = playerSeat !== null && winner === playerSeat;
  const playerLost = playerSeat !== null && winner !== null && winner !== playerSeat;
  const finishReason: FinishReason | null = multiplayerSnapshot
    ? getFinishReason(multiplayerSnapshot.state)
    : null;

  const isDraw = multiplayerSnapshot ? isGameOver(multiplayerSnapshot.state) && !winner : false;

  // Tournament post-game: auto-redirect countdown hooks (must be top-level)
  const [tournamentRedirectSeconds, setTournamentRedirectSeconds] = useState<number | null>(null);
  const tournamentRedirectCancelledRef = useRef(false);

  const gameOverTitle = isDraw
    ? t("draw")
    : playerWon
      ? t("youWon")
      : playerLost
        ? t("youLost")
        : winner
          ? t("wins", { color: translatePlayerColor(winner, t)! })
          : "";

  function describeFinishReason(): string {
    if (!finishReason) return t("gameOver");
    if (finishReason === "board_full") return t("boardFullDesc");
    if (playerWon) {
      switch (finishReason) {
        case "captured":
          return t("youCapturedDesc");
        case "forfeit":
          return t("opponentForfeitedDesc");
        case "timeout":
          return t("opponentTimedOutDesc");
      }
    }
    if (playerLost) {
      switch (finishReason) {
        case "captured":
          return t("opponentCapturedDesc");
        case "forfeit":
          return t("youForfeitedDesc");
        case "timeout":
          return t("youTimedOutDesc");
      }
    }
    // Spectator
    switch (finishReason) {
      case "captured":
        return t("spectatorCaptured", { color: translatePlayerColor(winner!, t)! });
      case "forfeit":
        return t("spectatorForfeit", {
          color: translatePlayerColor(winner === "white" ? "black" : "white", t)!,
        });
      case "timeout":
        return t("spectatorTimeout", {
          color: translatePlayerColor(winner === "white" ? "black" : "white", t)!,
        });
    }
  }

  const gameOverDescription = describeFinishReason();

  const { whiteTime, blackTime } = useGameClock(
    multiplayerSnapshot?.clock ?? null,
    multiplayerSnapshot?.state.currentTurn ?? "white",
    multiplayerSnapshot?.status ?? "waiting",
    { firstMoveDeadline: multiplayerSnapshot?.firstMoveDeadline },
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
  const isInPlayerList =
    isMultiplayerParticipant ||
    (multiplayerSnapshot &&
      auth &&
      multiplayerSnapshot.players.some((p) => p.player.playerId === auth.player.playerId)) ||
    false;
  const isSpectator = multiplayerSnapshot && !isMultiplayerParticipant;
  const spectatorCount = multiplayerSnapshot?.spectators.length ?? 0;
  const isTournamentGame = multiplayerSnapshot?.roomType === "tournament";
  const tournamentBackPath =
    isTournamentGame && multiplayerSnapshot?.tournamentId
      ? `/tournament/${multiplayerSnapshot.tournamentId}`
      : "/";
  const backLabel = isTournamentGame ? tCommon("backToTournament") : tCommon("backToLobby");

  // Tournament post-game: opponent info for "add as friend"
  const tournamentOpponent =
    isTournamentGame && playerSeat && multiplayerSnapshot
      ? (multiplayerSnapshot.seats[playerSeat === "white" ? "black" : "white"]?.player ?? null)
      : null;
  const tournamentOpponentIsFriend = tournamentOpponent
    ? liveSocialOverview.friends.some((f) => f.playerId === tournamentOpponent.playerId)
    : false;
  const tournamentOpponentHasPending = tournamentOpponent
    ? liveSocialOverview.outgoingFriendRequests.some(
        (f) => f.playerId === tournamentOpponent.playerId,
      )
    : false;
  const canAddTournamentOpponent =
    tournamentOpponent &&
    auth?.player.kind === "account" &&
    tournamentOpponent.kind === "account" &&
    !tournamentOpponentIsFriend &&
    !tournamentOpponentHasPending &&
    tournamentOpponent.playerId !== auth?.player.playerId;

  // Tournament post-game: auto-redirect countdown (10 seconds)
  useEffect(() => {
    if (isTournamentGame && isMultiplayerParticipant && winner && !wasFinishedOnLoadRef.current) {
      tournamentRedirectCancelledRef.current = false;
      setTournamentRedirectSeconds(10);
    }
  }, [isTournamentGame, isMultiplayerParticipant, winner]);

  useEffect(() => {
    if (tournamentRedirectSeconds === null || tournamentRedirectCancelledRef.current) return;
    if (tournamentRedirectSeconds <= 0) {
      router.push(tournamentBackPath);
      return;
    }
    const timer = setTimeout(() => {
      setTournamentRedirectSeconds((s) => (s !== null ? s - 1 : null));
    }, 1000);
    return () => clearTimeout(timer);
  }, [tournamentRedirectSeconds, router, tournamentBackPath]);

  const cancelTournamentRedirect = useCallback(() => {
    tournamentRedirectCancelledRef.current = true;
    setTournamentRedirectSeconds(null);
  }, []);

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
      toast(t("opponentRequestedTakeback"), {
        action: {
          label: tCommon("accept"),
          onClick: () => sendMultiplayerMessage({ type: "accept-takeback" }),
        },
        cancel: {
          label: tCommon("decline"),
          onClick: () => sendMultiplayerMessage({ type: "decline-takeback" }),
        },
        duration: Infinity,
      });
    }
    if (!takebackRequester) {
      lastTakebackToastRef.current = null;
    }
  }, [multiplayerSnapshot?.takeback?.requestedBy, playerSeat]);

  // Toast for incoming rematch requests.
  // Skip the initial toast when the page loads with an existing rematch request,
  // because the lobby already showed that notification before the player navigated here.
  const lastRematchToastRef = useRef(false);
  const initialRematchSuppressedRef = useRef(false);
  useEffect(() => {
    // Spectators should never see rematch toasts
    if (!playerSeat) return;

    const rematchRequesters = multiplayerSnapshot?.rematch?.requestedBy ?? [];
    const opponentRequested = rematchRequesters.some((color) => color !== playerSeat);
    const weAlreadyRequested = rematchRequesters.includes(playerSeat);

    const rematchToastId = `rematch-${multiplayerSnapshot?.gameId ?? "unknown"}`;
    if (opponentRequested && !weAlreadyRequested && !lastRematchToastRef.current) {
      // Suppress the very first rematch toast on page load — the lobby already showed it
      if (!initialRematchSuppressedRef.current) {
        initialRematchSuppressedRef.current = true;
        lastRematchToastRef.current = true;
      } else {
        lastRematchToastRef.current = true;
        const opponentSeat = playerSeat === "white" ? "black" : "white";
        const opponentName =
          multiplayerSnapshot?.seats[opponentSeat]?.player.displayName ?? "undefined";
        const boardSize = multiplayerSnapshot?.state.boardSize;
        const scoreToWin = multiplayerSnapshot?.state.scoreToWin;
        const tc = multiplayerSnapshot?.timeControl;
        const tcLabel = tc
          ? `${Math.floor(tc.initialMs / 60000)}+${Math.floor(tc.incrementMs / 1000)}`
          : null;
        const details = [
          boardSize ? `${boardSize}x${boardSize}` : null,
          scoreToWin ? `${scoreToWin}pts` : null,
          tcLabel,
        ]
          .filter(Boolean)
          .join(", ");

        toast(t("opponentWantsRematch", { opponent: opponentName }), {
          id: rematchToastId,
          description: details || undefined,
          action: {
            label: tCommon("accept"),
            onClick: () => sendMultiplayerMessage({ type: "request-rematch" }),
          },
          cancel: {
            label: tCommon("decline"),
            onClick: () => sendMultiplayerMessage({ type: "decline-rematch" }),
          },
          duration: Infinity,
        });
      }
    }
    if (!opponentRequested) {
      initialRematchSuppressedRef.current = true;
      if (lastRematchToastRef.current) {
        toast.dismiss(rematchToastId);
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

  const isTournamentUnstarted =
    multiplayerSnapshot?.roomType === "tournament" &&
    multiplayerSnapshot?.status === "active" &&
    multiplayerSnapshot?.tournamentReady === false;

  const multiplayerWaitingOnOpponent =
    multiplayerSnapshot?.status === "active" &&
    !isTournamentUnstarted &&
    !!playerSeat &&
    multiplayerSnapshot.state.currentTurn !== playerSeat;

  const multiplayerStatusTitle = !multiplayerSnapshot
    ? t("game")
    : isDraw
      ? t("drawTitle")
      : winner
        ? t("colorWins", { color: translatePlayerColor(winner, t)! })
        : multiplayerSnapshot.status === "waiting"
          ? t("waiting")
          : isTournamentUnstarted
            ? t("waitingForOpponentToConnect")
            : isSpectator
              ? t("spectating")
              : multiplayerYourTurn
                ? t("yourMove")
                : t("waitingForOpponent");

  const [copyFeedbackKey, setCopyFeedbackKey] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  function copyToClipboard(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    }
    return fallbackCopy(text);
  }

  function fallbackCopy(text: string): Promise<void> {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      document.execCommand("copy");
      return Promise.resolve();
    } catch {
      return Promise.reject(new Error(tCommon("failedToCopy")));
    } finally {
      document.body.removeChild(textarea);
    }
  }

  async function handleCopyGameId() {
    if (!multiplayerSnapshot) return;
    try {
      await copyToClipboard(multiplayerSnapshot.gameId);
      setCopyFeedback(tCommon("copied"));
      setCopyFeedbackKey("game-id");
      toast.success(tCommon("copiedGameId", { gameId: multiplayerSnapshot.gameId }));
      setTimeout(() => {
        setCopyFeedback(null);
        setCopyFeedbackKey(null);
      }, 2000);
    } catch {
      toast.error(tCommon("failedToCopy"));
    }
  }

  async function handleCopyGameLink() {
    if (!multiplayerSnapshot) return;
    try {
      const url = `${window.location.origin}/game/${multiplayerSnapshot.gameId}`;
      await copyToClipboard(url);
      setCopyFeedback(t("linkCopied"));
      setCopyFeedbackKey("share-link");
      toast.success(tCommon("copiedShareLink"));
      setTimeout(() => {
        setCopyFeedback(null);
        setCopyFeedbackKey(null);
      }, 2000);
    } catch {
      toast.error(tCommon("failedToCopy"));
    }
  }

  async function handleCopySpectateLink() {
    if (!multiplayerSnapshot) return;
    try {
      const url = `${window.location.origin}/game/${multiplayerSnapshot.gameId}?spectate=true`;
      await copyToClipboard(url);
      setCopyFeedback(tCommon("spectateLinkCopied"));
      setCopyFeedbackKey("spectate-link");
      toast.success(tCommon("spectateLinkCopied"));
      setTimeout(() => {
        setCopyFeedback(null);
        setCopyFeedbackKey(null);
      }, 2000);
    } catch {
      toast.error(tCommon("failedToCopy"));
    }
  }

  const multiplayerJumpTargets =
    multiplayerSelection && displayState && !isReviewMode
      ? getJumpTargets(displayState, multiplayerSelection, displayState.currentTurn)
      : [];

  const handleBoardClick = (position: Position) => {
    if (!multiplayerSnapshot || !playerSeat || !multiplayerYourTurn) return;

    const state = multiplayerSnapshot.state;
    const tile = state.positions[position.y][position.x];
    const activeOrigin = multiplayerSelection;
    const jumpTargets = activeOrigin ? getJumpTargets(state, activeOrigin, state.currentTurn) : [];

    if (activeOrigin && arePositionsEqual(activeOrigin, position)) {
      if (state.pendingJump.length > 0) {
        sendMultiplayerMessage({ type: "confirm-jump" });
        setMultiplayerSelection(null);
      } else {
        setMultiplayerSelection(null);
      }
      return;
    }

    if (activeOrigin && jumpTargets.some((t) => arePositionsEqual(t, position))) {
      sendMultiplayerMessage({
        type: "jump-piece",
        from: activeOrigin,
        to: position,
      });
      setMultiplayerSelection(position);
      return;
    }

    if (tile === playerSeat && state.pendingJump.length === 0) {
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

  const boardWrapStyle = {
    aspectRatio: "1/1",
  };

  // Show the loading skeleton from the very first render until the snapshot
  // is available, instead of only while `multiplayerBusy` is true. The previous
  // condition (`multiplayerBusy && !multiplayerSnapshot`) missed the initial
  // frame — on first render `multiplayerBusy` is still false (the loadGame
  // effect hasn't run yet), so the main return body rendered with an empty
  // board area, producing a white flash before the skeleton appeared.
  // The rules-intro modal is intentionally excluded so it can still render
  // over the empty page when a new player needs to acknowledge the rules.
  if (!multiplayerSnapshot && !rulesIntroOpen) {
    return <LoadingBoardSkeleton />;
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 bg-[radial-gradient(circle_at_top,rgba(255,247,231,0.76),transparent_58%)]" />

      <Navbar
        mode="multiplayer"
        auth={auth}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen((v) => !v)}
        onCloseNav={() => setNavOpen(false)}
        onOpenAuth={onOpenAuth}
        onLogout={onLogout}
      />

      {multiplayerSnapshot?.roomType === "tournament" && multiplayerSnapshot.tournamentId && (
        <TournamentContextBar
          tournamentId={multiplayerSnapshot.tournamentId}
          tournamentName="Tournament"
        />
      )}

      <main className="mx-auto flex max-w-416 flex-col gap-5 px-4 pb-3 pt-16 sm:px-6 sm:pt-5 lg:px-6 lg:pb-4 xl:pt-2">
        <section className="grid gap-3 xl:min-h-[calc(100dvh-1rem)] xl:content-center xl:gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,30rem)] xl:items-start">
          <div className="flex items-center justify-center xl:items-start xl:justify-end">
            <div
              className="relative isolate mx-auto w-full max-w-[min(100%,calc(100svh-8rem))] xl:max-w-[min(100%,calc(100svh-3rem))]"
              style={boardWrapStyle}
            >
              {displayState && (
                <TiaoBoard
                  state={displayState}
                  selectedPiece={isReviewMode ? null : multiplayerSelection}
                  jumpTargets={multiplayerJumpTargets}
                  confirmReady={true}
                  lastMove={reviewLastMove}
                  onPointClick={isReviewMode ? undefined : handleBoardClick}
                  disabled={isReviewMode || !multiplayerYourTurn || isTournamentUnstarted}
                  onUndoLastJump={
                    isReviewMode
                      ? undefined
                      : () =>
                          sendMultiplayerMessage({
                            type: "undo-pending-jump-step",
                          })
                  }
                  onConfirmJump={
                    isReviewMode
                      ? undefined
                      : () => {
                          sendMultiplayerMessage({ type: "confirm-jump" });
                          setMultiplayerSelection(null);
                        }
                  }
                />
              )}
              {/* Review nav buttons moved to card header pill area */}
              {(multiplayerSnapshot?.status === "waiting" || isTournamentUnstarted) && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="flex items-center gap-3 rounded-3xl border border-[#dcc7a2] bg-[#fff7ec]/92 px-5 py-3 text-sm font-semibold text-[#5d4732] shadow-lg backdrop-blur-sm">
                    <HourglassSpinner className="text-[#7b5f3f]" />
                    {isTournamentUnstarted
                      ? t("waitingForOpponentToConnect")
                      : isSpectator
                        ? t("waitingForGameToStart")
                        : t("waitingForOpponent")}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="mx-auto w-full max-w-[calc(100svh-8rem)] space-y-4 xl:mx-0 xl:w-auto xl:min-w-88 xl:max-w-120">
            <div className="mx-auto w-full xl:mx-0">
              <PaperCard
                className={cn(
                  multiplayerYourTurn &&
                    "border-[#b7cb8d] bg-[linear-gradient(180deg,rgba(251,255,243,0.98),rgba(240,248,224,0.96))]",
                )}
              >
                <CardHeader className="gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <GamePanelBrand />
                      <span className="hidden sm:contents">
                        <Badge className="w-fit bg-[#eee3cf] text-[#5f4932] mt-1">
                          {t("multiplayer")}
                        </Badge>
                      </span>
                    </div>
                    <div className="flex min-w-0 shrink justify-end">
                      {isReviewMode && multiplayerSnapshot && reviewMoveIndex !== null ? (
                        <motion.div
                          initial={{ opacity: 0, y: -8, scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          className="flex items-center rounded-full border border-[#d8c29c] bg-[#fff8ee]/96 px-1 py-1 shadow-[0_16px_28px_-22px_rgba(67,45,24,0.5)] backdrop-blur-sm"
                          data-testid="review-nav-buttons"
                        >
                          <MoveListNavButtons
                            history={multiplayerSnapshot.state.history}
                            currentMoveIndex={reviewMoveIndex}
                            onSelectMove={setReviewMoveIndex}
                          />
                        </motion.div>
                      ) : multiplayerSnapshot && connectionState !== "connected" ? (
                        <motion.div
                          initial={{ opacity: 0, y: -8, scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          className="flex items-center gap-2 rounded-full border border-[#d8c29c] bg-[#fff8ee]/96 px-3 py-2 text-sm font-semibold text-[#5d4732] shadow-[0_16px_28px_-22px_rgba(67,45,24,0.5)] backdrop-blur-sm"
                        >
                          <HourglassSpinner className="text-[#7b5f3f]" />
                          {connectionState === "connecting" ? t("connecting") : t("reconnecting")}
                        </motion.div>
                      ) : isAwaitingFirstMove && multiplayerYourTurn ? (
                        <motion.div
                          initial={{ opacity: 0, y: -8, scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          className="flex items-center gap-2 rounded-full border border-[#c9a84c] bg-[#fffbeb]/96 px-3 py-2 text-sm font-semibold text-[#8b6914] shadow-[0_16px_28px_-22px_rgba(139,105,20,0.42)] backdrop-blur-sm"
                        >
                          <span className="font-mono tabular-nums text-base">
                            {formatClockTime(firstMoveCountdownMs)}
                          </span>
                          <span>{t("toMakeFirstMove")}</span>
                        </motion.div>
                      ) : isAwaitingFirstMove && multiplayerWaitingOnOpponent ? (
                        <motion.div
                          initial={{ opacity: 0, y: -8, scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          className="flex items-center gap-2 rounded-full border border-[#d8c29c] bg-[#fff8ee]/96 px-3 py-2 text-sm font-semibold text-[#5d4732] shadow-[0_16px_28px_-22px_rgba(67,45,24,0.5)] backdrop-blur-sm"
                        >
                          <HourglassSpinner className="text-[#7b5f3f]" />
                          <span className="font-mono tabular-nums">
                            {formatClockTime(firstMoveCountdownMs)}
                          </span>
                          <span>{t("opponentsFirstMove")}</span>
                        </motion.div>
                      ) : multiplayerYourTurn ? (
                        <div className="flex items-center gap-2">
                          {hasClock && (
                            <InlineClockBadge timeMs={activeClockMs} className="ml-0 text-base" />
                          )}
                          <motion.div
                            initial={{ opacity: 0, y: -8, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            className="flex items-center whitespace-nowrap rounded-full border border-[#b8cc8f] bg-[#f7fce9]/96 px-3 py-2 text-sm font-semibold text-[#56703f] shadow-[0_16px_28px_-22px_rgba(63,92,32,0.42)] backdrop-blur-sm"
                          >
                            {t("yourMove")}
                          </motion.div>
                        </div>
                      ) : multiplayerWaitingOnOpponent ? (
                        <div className="flex items-center gap-2 min-w-0">
                          {hasClock && yourClockMs != null && (
                            <InlineClockBadge timeMs={yourClockMs} className="ml-0 text-base" />
                          )}
                          <motion.div
                            initial={{ opacity: 0, y: -8, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            className="flex items-center gap-2 rounded-full border border-[#d8c29c] bg-[#fff8ee]/96 px-3 py-2 text-sm font-semibold text-[#5d4732] shadow-[0_16px_28px_-22px_rgba(67,45,24,0.5)] backdrop-blur-sm min-w-0"
                          >
                            <HourglassSpinner className="shrink-0 text-[#7b5f3f]" />
                            <span className="truncate">{t("waitingForOpponent")}</span>
                          </motion.div>
                        </div>
                      ) : isSpectator && multiplayerSnapshot?.status === "active" ? (
                        <div className="flex items-center gap-2">
                          {hasClock && (
                            <InlineClockBadge timeMs={activeClockMs} className="ml-0 text-base" />
                          )}
                          <motion.div
                            initial={{ opacity: 0, y: -8, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            className="flex items-center gap-2 rounded-full border border-[#c4b5d4] bg-[#f5f0fc]/96 px-3 py-2 text-sm font-semibold text-[#5a4570] shadow-[0_16px_28px_-22px_rgba(90,69,112,0.42)] backdrop-blur-sm"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                            {t("spectating")}
                          </motion.div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-col gap-3 border-t border-black/5 pt-4 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
                    {multiplayerSnapshot && (
                      <div className="flex items-center gap-2 sm:order-2">
                        <RoomCodeCopyPill
                          gameId={multiplayerSnapshot.gameId}
                          copied={copyFeedbackKey === "game-id" && !!copyFeedback}
                          onCopy={handleCopyGameId}
                          hideCopyIcon={isReviewMode}
                        />
                        <ShareLinkCopyPill
                          copied={copyFeedbackKey === "share-link" && !!copyFeedback}
                          onCopy={handleCopyGameLink}
                        />
                        <SpectateButton
                          copied={copyFeedbackKey === "spectate-link" && !!copyFeedback}
                          spectatorCount={spectatorCount}
                          onCopy={handleCopySpectateLink}
                          onShowSpectators={() => setSpectatorDialogOpen(true)}
                        />
                      </div>
                    )}
                    <div className="space-y-1 sm:order-1">
                      <CardTitle className="font-display text-2xl text-[#2b1e14] whitespace-nowrap">
                        {multiplayerSnapshot?.status === "active"
                          ? isSpectator
                            ? t("spectating")
                            : t("liveMatch")
                          : multiplayerStatusTitle}
                        {multiplayerSnapshot?.status === "waiting" && <AnimatedEllipsis />}
                      </CardTitle>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  {multiplayerSnapshot ? (
                    <>
                      {multiplayerSnapshot.status === "waiting" ? (
                        <>
                          <div className="grid grid-cols-1 gap-4">
                            <AnimatedScoreTile
                              label={t("black")}
                              value={(displayState ?? multiplayerSnapshot.state).score.black}
                              pulseKey={0}
                              className="rounded-3xl border border-black/10 bg-[linear-gradient(180deg,#39312b,#14100d)] p-5 text-[#f9f2e8]"
                              labelClassName="text-xs uppercase tracking-wider"
                              scoreToWin={multiplayerSnapshot.state.scoreToWin}
                            />
                            <AnimatedScoreTile
                              label={t("white")}
                              value={(displayState ?? multiplayerSnapshot.state).score.white}
                              pulseKey={0}
                              className="rounded-3xl border border-[#d3c3ad] bg-[linear-gradient(180deg,#fffef8,#efe4d1)] p-5 text-[#2b1e14]"
                              labelClassName="text-xs uppercase tracking-wider"
                              scoreToWin={multiplayerSnapshot.state.scoreToWin}
                            />
                          </div>
                          <div className="space-y-2">
                            {Array.from({ length: 2 }, (_, index) => {
                              const slot = multiplayerSnapshot.players[index] ?? null;
                              return (
                                <div
                                  key={`lobby-player-${index}`}
                                  className="flex items-center justify-between gap-3 rounded-3xl border border-[#d8c29c] bg-[#fffaf1] px-4 py-3"
                                >
                                  {slot ? (
                                    <PlayerIdentityRow
                                      player={slot.player}
                                      currentPlayerId={auth?.player.playerId}
                                      online={slot.online}
                                      friendVariant="light"
                                      linkToProfile={false}
                                      className="min-w-0 flex-1 gap-3"
                                    />
                                  ) : (
                                    <div className="flex items-center gap-3">
                                      <EmptySeatAvatar />
                                      <p className="text-sm text-[#7a6656]">{t("waitingToJoin")}</p>
                                    </div>
                                  )}
                                  <Badge
                                    className={cn(
                                      slot?.online
                                        ? "bg-[#eef2e8] text-[#43513f]"
                                        : "bg-[#f2e8d9] text-[#6e5b48]",
                                    )}
                                  >
                                    {slot?.online ? t("online") : t("offline")}
                                  </Badge>
                                </div>
                              );
                            })}
                            {auth?.player.kind === "account" &&
                              isInPlayerList &&
                              multiplayerSnapshot.players.length < 2 && (
                                <Button
                                  variant="secondary"
                                  className="w-full border-[#dcc7a2]"
                                  onClick={() => setInviteDialogOpen(true)}
                                >
                                  {t("inviteFriend")}
                                </Button>
                              )}
                            <p className="mt-2 text-xs leading-relaxed text-[#7a6656]">
                              {t("lobbyShareHint")}
                            </p>
                          </div>
                        </>
                      ) : (
                        <div className="grid grid-cols-1 gap-4">
                          {(["black", "white"] as PlayerColor[]).map((color) => {
                            const seat = multiplayerSnapshot.seats[color];
                            const isYourSeat = seat?.player.playerId === auth?.player.playerId;
                            const isAccount = auth?.player.kind === "account";
                            const opponentId = seat?.player.playerId;

                            const isFriend =
                              !isYourSeat && opponentId
                                ? liveSocialOverview.friends.some((f) => f.playerId === opponentId)
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

                            const tileVariant = color === "black" ? "dark" : "light";
                            const tileStyle =
                              color === "black"
                                ? "rounded-3xl border border-black/10 bg-[linear-gradient(180deg,#39312b,#14100d)] p-5 text-[#f9f2e8]"
                                : "rounded-3xl border border-[#d3c3ad] bg-[linear-gradient(180deg,#fffef8,#efe4d1)] p-5 text-[#2b1e14]";

                            return (
                              <AnimatedScoreTile
                                key={color}
                                label={t(color)}
                                value={(displayState ?? multiplayerSnapshot.state).score[color]}
                                pulseKey={0}
                                className={tileStyle}
                                labelClassName="text-xs uppercase tracking-wider"
                                clockMs={
                                  hasClock ? (color === "white" ? whiteTime : blackTime) : null
                                }
                                clockActive={
                                  hasClock &&
                                  multiplayerSnapshot.state.currentTurn === color &&
                                  multiplayerSnapshot.status === "active"
                                }
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
                                              social.handleSendFriendRequest(seat.player.playerId)
                                          : undefined,
                                        addFriendBusy:
                                          social.socialActionBusyKey ===
                                          `friend-send:${seat.player.playerId}`,
                                        onCancelFriendRequest: hasPendingOutgoing
                                          ? () =>
                                              social.handleCancelFriendRequest(seat.player.playerId)
                                          : undefined,
                                        cancelFriendRequestBusy:
                                          social.socialActionBusyKey ===
                                          `friend-cancel:${seat.player.playerId}`,
                                      }
                                    : undefined
                                }
                                scoreToWin={multiplayerSnapshot.state.scoreToWin}
                              />
                            );
                          })}
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
                              {t("forfeit")}
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
                                  {t("opponentRequestedTakeback")}
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
                                    {tCommon("accept")}
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
                                    {tCommon("decline")}
                                  </Button>
                                </div>
                              </div>
                            ) : multiplayerSnapshot.takeback?.requestedBy === playerSeat ? (
                              <div className="flex items-center gap-2 rounded-2xl border border-[#d8c29c] bg-[#fff8ee] px-4 py-3">
                                <HourglassSpinner className="text-[#7b5f3f]" />
                                <p className="text-sm font-medium text-[#5d4732]">
                                  {t("takebackRequested")}
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
                                  (multiplayerSnapshot.takeback?.declinedCount?.[
                                    playerSeat as PlayerColor
                                  ] ?? 0) >= 3
                                }
                              >
                                {(multiplayerSnapshot.takeback?.declinedCount?.[
                                  playerSeat as PlayerColor
                                ] ?? 0) >= 3
                                  ? t("noTakebacksLeft")
                                  : t("requestTakeback")}
                              </Button>
                            )}
                          </div>
                        )}

                      {winner &&
                        isMultiplayerParticipant &&
                        connectionState === "connected" &&
                        (isTournamentGame ? (
                          <div className="grid gap-2 border-t border-[#dbc6a2] pt-4">
                            <Button onClick={() => router.push(tournamentBackPath)}>
                              {tCommon("backToTournament")}
                            </Button>
                            {canAddTournamentOpponent && tournamentOpponent && (
                              <Button
                                variant="secondary"
                                onClick={() =>
                                  social.handleSendFriendRequest(tournamentOpponent.playerId)
                                }
                                disabled={
                                  social.socialActionBusyKey ===
                                  `friend-send:${tournamentOpponent.playerId}`
                                }
                              >
                                <PlayerIdentityRow
                                  player={tournamentOpponent}
                                  avatarClassName="h-5 w-5"
                                  linkToProfile={false}
                                  friendVariant="light"
                                  nameClassName="text-sm"
                                />
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              onClick={() => router.push(tournamentBackPath)}
                            >
                              {t("goToNextMatch")}
                            </Button>
                            {tournamentRedirectSeconds !== null && (
                              <button
                                type="button"
                                className="text-center text-xs text-[#6e5b48] hover:text-[#2b1e14] transition-colors"
                                onClick={cancelTournamentRedirect}
                              >
                                {t("redirectingIn", { seconds: tournamentRedirectSeconds })}
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="grid gap-2 border-t border-[#dbc6a2] pt-4">
                            {multiplayerSnapshot.rematch?.requestedBy.includes(
                              playerSeat as PlayerColor,
                            ) ? (
                              <div className="space-y-2">
                                <p className="text-center text-sm font-medium text-[#56703f]">
                                  {t("rematchRequestedWaiting")}
                                </p>
                                {!multiplayerSnapshot.seats[
                                  playerSeat === "white" ? "black" : "white"
                                ]?.online && (
                                  <p className="text-center text-xs text-[#6e5b48]">
                                    {t("rematchOfflineDesc")}
                                  </p>
                                )}
                                {(multiplayerSnapshot.rematch?.requestedBy ?? []).some(
                                  (color) => color !== playerSeat,
                                ) && (
                                  <p className="text-center text-xs text-[#6e5b48]">
                                    {t("rematchBothWant")}
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
                                    if (multiplayerSnapshot.rematch?.requestedBy.length) {
                                      toast.dismiss(`rematch-${multiplayerSnapshot.gameId}`);
                                    } else {
                                      toast.success(t("rematchSent"));
                                    }
                                  }}
                                >
                                  {multiplayerSnapshot.rematch?.requestedBy.length
                                    ? t("acceptRematch")
                                    : t("rematch")}
                                </Button>
                                {(multiplayerSnapshot.rematch?.requestedBy ?? []).some(
                                  (color) => color !== playerSeat,
                                ) ? (
                                  <Button
                                    variant="outline"
                                    onClick={() =>
                                      sendMultiplayerMessage({
                                        type: "decline-rematch",
                                      })
                                    }
                                  >
                                    {tCommon("decline")}
                                  </Button>
                                ) : (
                                  <Button variant="outline" onClick={() => router.push("/")}>
                                    {tCommon("lobby")}
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                        ))}

                      {isReviewMode &&
                        !(isMultiplayerParticipant && connectionState === "connected") && (
                          <div className="grid gap-2 border-t border-[#dbc6a2] pt-4">
                            <Button variant="ghost" onClick={() => router.push(tournamentBackPath)}>
                              {backLabel}
                            </Button>
                          </div>
                        )}

                      {multiplayerSnapshot.state.history.length > 0 && (
                        <div className="border-t border-[#dbc6a2] pt-4">
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#7b6550]">
                            {t("moveHistory")}
                          </p>
                          <MoveList
                            history={multiplayerSnapshot.state.history}
                            currentMoveIndex={
                              isReviewMode
                                ? reviewMoveIndex
                                : multiplayerSnapshot.state.history.length - 1
                            }
                            onSelectMove={isReviewMode ? setReviewMoveIndex : undefined}
                            interactive={isReviewMode}
                            hideNavButtons={isReviewMode}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            className="mt-2 w-full text-xs text-[#8d7760]"
                            onClick={() => {
                              const notation = formatGameNotation(
                                multiplayerSnapshot.state.history,
                                {
                                  gameId: multiplayerSnapshot.gameId,
                                  white: multiplayerSnapshot.seats.white?.player.displayName,
                                  black: multiplayerSnapshot.seats.black?.player.displayName,
                                  boardSize: multiplayerSnapshot.state.boardSize,
                                  scoreToWin: multiplayerSnapshot.state.scoreToWin,
                                },
                              );
                              void navigator.clipboard.writeText(notation).then(() => {
                                toast.success(t("gameNotationCopied"));
                              });
                            }}
                          >
                            {t("copyGameNotation")}
                          </Button>
                        </div>
                      )}

                      {isSpectator && (
                        <div className="grid gap-2 border-t border-[#dbc6a2] pt-4">
                          <Button variant="ghost" onClick={() => router.push(tournamentBackPath)}>
                            {backLabel}
                          </Button>
                        </div>
                      )}
                    </>
                  ) : multiplayerBusy ? (
                    <div className="flex flex-col items-center py-12 gap-3">
                      <HourglassSpinner className="h-8 w-8 text-[#a6824d]" />
                      <p className="text-sm text-[#6e5b48]">{t("loadingMatch")}</p>
                    </div>
                  ) : null}
                </CardContent>
              </PaperCard>
            </div>
          </div>
        </section>
      </main>

      <InviteFriendsModal
        open={inviteDialogOpen}
        onOpenChange={setInviteDialogOpen}
        gameId={gameId}
        socialOverview={liveSocialOverview}
        playerIds={(multiplayerSnapshot?.players ?? []).map((s) => s.player.playerId)}
        onInvite={handleInviteFriend}
        onRevoke={handleRevokeInvite}
        inviteBusy={inviteBusy}
        revokeBusy={revokeBusy}
        isGameFull={!!(multiplayerSnapshot?.seats.white && multiplayerSnapshot?.seats.black)}
      />

      <Dialog
        open={forfeitDialogOpen}
        onOpenChange={setForfeitDialogOpen}
        title={t("forfeitGame")}
        description={t("forfeitConfirm")}
      >
        <div className="flex gap-3 justify-end">
          <Button variant="outline" onClick={() => setForfeitDialogOpen(false)}>
            {tCommon("cancel")}
          </Button>
          <Button
            className="bg-[#9b4030] text-white hover:bg-[#7a2e22]"
            onClick={() => {
              setForfeitDialogOpen(false);
              sendMultiplayerMessage({ type: "forfeit" });
            }}
          >
            {t("forfeit")}
          </Button>
        </div>
      </Dialog>

      {gameOverDialogOpen && (
        <canvas
          ref={confettiCanvasCallback}
          className="pointer-events-none fixed inset-0 z-400 h-full w-full"
        />
      )}

      <Dialog
        open={gameOverDialogOpen}
        onOpenChange={setGameOverDialogOpen}
        title={gameOverTitle}
        description={gameOverDescription}
      >
        <div className="grid gap-2">
          {/* Spectator: show winner's profile picture + name + color */}
          {isSpectator && winner && multiplayerSnapshot?.seats[winner] && (
            <div className="flex items-center justify-center gap-3 py-2">
              <PlayerIdentityRow
                player={multiplayerSnapshot.seats[winner]!.player}
                avatarClassName="h-10 w-10"
                linkToProfile={false}
                friendVariant="light"
                nameClassName="font-semibold text-[#2b1e14]"
              />
            </div>
          )}
          {/* Elo rating change after game */}
          {multiplayerSnapshot?.ratingAfter &&
            multiplayerSnapshot?.ratingBefore &&
            playerSeat &&
            (() => {
              const before = multiplayerSnapshot.ratingBefore[playerSeat];
              const after = multiplayerSnapshot.ratingAfter[playerSeat];
              const delta = after - before;
              return (
                <AnimatedRatingChange
                  label={t("ratingChange")}
                  before={before}
                  after={after}
                  delta={delta}
                />
              );
            })()}
          {isMultiplayerParticipant && connectionState === "connected" ? (
            isTournamentGame ? (
              <>
                <Button
                  onClick={() => {
                    setGameOverDialogOpen(false);
                    cancelTournamentRedirect();
                    router.push(tournamentBackPath);
                  }}
                >
                  {tCommon("backToTournament")}
                </Button>
                {canAddTournamentOpponent && tournamentOpponent && (
                  <Button
                    variant="secondary"
                    onClick={() => social.handleSendFriendRequest(tournamentOpponent.playerId)}
                    disabled={
                      social.socialActionBusyKey === `friend-send:${tournamentOpponent.playerId}`
                    }
                  >
                    <PlayerIdentityRow
                      player={tournamentOpponent}
                      avatarClassName="h-5 w-5"
                      linkToProfile={false}
                      friendVariant="light"
                      nameClassName="text-sm"
                    />
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => {
                    setGameOverDialogOpen(false);
                    cancelTournamentRedirect();
                    router.push(tournamentBackPath);
                  }}
                >
                  {t("goToNextMatch")}
                </Button>
                {tournamentRedirectSeconds !== null && (
                  <button
                    type="button"
                    className="text-center text-xs text-[#6e5b48] hover:text-[#2b1e14] transition-colors"
                    onClick={cancelTournamentRedirect}
                  >
                    {t("redirectingIn", { seconds: tournamentRedirectSeconds })}
                  </button>
                )}
              </>
            ) : (
              <>
                {multiplayerSnapshot?.rematch?.requestedBy.includes(playerSeat as PlayerColor) ? (
                  <p className="text-center text-sm font-medium text-[#56703f] py-2">
                    {t("rematchRequestedWaiting")}
                  </p>
                ) : (
                  <Button
                    onClick={() => {
                      sendMultiplayerMessage({ type: "request-rematch" });
                      if (multiplayerSnapshot?.rematch?.requestedBy.length) {
                        toast.dismiss(`rematch-${multiplayerSnapshot.gameId}`);
                      } else {
                        toast.success(t("rematchSent"));
                      }
                      setGameOverDialogOpen(false);
                    }}
                  >
                    {multiplayerSnapshot?.rematch?.requestedBy.length
                      ? t("acceptRematch")
                      : t("rematch")}
                  </Button>
                )}
              </>
            )
          ) : null}
          <Button
            variant="ghost"
            onClick={() => {
              setGameOverDialogOpen(false);
              router.push(tournamentBackPath);
            }}
          >
            {backLabel}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={spectatorDialogOpen}
        onOpenChange={setSpectatorDialogOpen}
        title={t("spectatorsCount", { count: spectatorCount })}
        description={t("spectatorsDesc")}
      >
        <div className="space-y-4">
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {multiplayerSnapshot?.spectators.length === 0 ? (
              <p className="text-center text-sm text-[#6e5b48] py-4">{t("noSpectatorsYet")}</p>
            ) : (
              multiplayerSnapshot?.spectators.map((slot) => {
                const specId = slot.player.playerId;
                const isYou = specId === auth?.player.playerId;
                const isAccount = auth?.player.kind === "account";
                const isFriend = liveSocialOverview.friends.some((f) => f.playerId === specId);
                const hasPendingOutgoing = liveSocialOverview.outgoingFriendRequests.some(
                  (f) => f.playerId === specId,
                );
                const hasPendingIncoming = liveSocialOverview.incomingFriendRequests.some(
                  (f) => f.playerId === specId,
                );
                const canBefriend =
                  isAccount &&
                  !isYou &&
                  slot.player.kind === "account" &&
                  !isFriend &&
                  !hasPendingOutgoing &&
                  !hasPendingIncoming;

                return (
                  <div
                    key={specId}
                    className="flex items-center justify-between rounded-2xl border border-[#d8c29c] bg-[#fffaf1] px-4 py-3"
                  >
                    <PlayerIdentityRow
                      player={slot.player}
                      currentPlayerId={auth?.player.playerId}
                      online={slot.online}
                      nameClassName="text-sm font-semibold text-[#2b1e14]"
                      className="gap-3"
                    />
                    <div className="flex items-center gap-2">
                      {isFriend && (
                        <Badge className="text-xs bg-emerald-100 text-emerald-700">
                          {tCommon("friend")}
                        </Badge>
                      )}
                      {hasPendingOutgoing && (
                        <Badge className="text-xs bg-[#f2e8d9] text-[#8d7760]">
                          {tCommon("pending")}
                        </Badge>
                      )}
                      {canBefriend && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs h-7 px-2"
                          onClick={() => social.handleSendFriendRequest(specId)}
                          disabled={social.socialActionBusyKey === `friend-send:${specId}`}
                        >
                          {social.socialActionBusyKey === `friend-send:${specId}`
                            ? t("sending")
                            : tCommon("addFriend")}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="space-y-2 border-t border-[#dbc6a2] pt-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#7b6550]">
              {t("inviteSpectators")}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 text-xs"
                onClick={handleCopySpectateLink}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mr-1.5"
                >
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                </svg>
                {copyFeedbackKey === "spectate-link" && copyFeedback ? copyFeedback : t("copyLink")}
              </Button>
              {typeof navigator !== "undefined" && "share" in navigator && (
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 text-xs"
                  onClick={() => {
                    const url = `${window.location.origin}/game/${multiplayerSnapshot?.gameId}?spectate`;
                    void navigator.share({
                      title: t("shareTitle"),
                      text: t("shareText"),
                      url,
                    });
                  }}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="mr-1.5"
                  >
                    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                    <polyline points="16 6 12 2 8 6" />
                    <line x1="12" x2="12" y1="2" y2="15" />
                  </svg>
                  {t("share")}
                </Button>
              )}
            </div>
          </div>
        </div>
      </Dialog>

      {/* Rules introduction modal for players who haven't completed the tutorial (#25).
          Non-dismissible (no X, no escape, no outside-click): the only ways out are
          going through the tutorial or explicitly acknowledging prior experience via
          the underlined link below the primary CTA. This prevents the "Game started!"
          toast from firing for players who casually dismissed an earlier "Got it"
          button without ever learning the rules. */}
      <Dialog
        open={rulesIntroOpen}
        onOpenChange={setRulesIntroOpen}
        title={t("welcomeToTiao")}
        description={t("welcomeToTiaoDesc")}
        closeable={false}
      >
        <div className="space-y-4">
          <div className="rounded-2xl border border-[#d7c39e] bg-[#fffaf3] overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {(
                  [
                    [t("ruleGeneral"), t("ruleGeneralDesc")],
                    [t("ruleWin"), t("ruleWinDesc")],
                    [t("rulePlace"), t("rulePlaceDesc")],
                    [t("ruleJump"), t("ruleJumpDesc")],
                    [t("ruleCluster"), t("ruleClusterDesc")],
                    [t("ruleBorder"), t("ruleBorderDesc")],
                  ] as const
                ).map(([rule, desc]) => (
                  <tr key={rule} className="border-b border-[#e8dcc8] last:border-0">
                    <td className="px-3 py-2 font-semibold text-[#2b1e14] whitespace-nowrap">
                      {rule}
                    </td>
                    <td className="px-3 py-2 text-[#6e5b48]">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3">
            <Button onClick={() => router.push("/tutorial?from=game")}>{t("learnToPlay")}</Button>
            {!(isSpectator && !isInPlayerList) && (
              <button
                type="button"
                className="text-center text-sm text-[#6e5b48] underline underline-offset-4 hover:text-[#2b1e14] transition-colors"
                onClick={() => {
                  localStorage.setItem("tiao:knowsHowToPlay", "1");
                  setRulesIntroOpen(false);
                  setReadyToJoin(true);
                }}
              >
                {t("iKnowHowToPlay")}
              </button>
            )}
            {isSpectator && !isInPlayerList && (
              <Button
                variant="outline"
                onClick={() => {
                  localStorage.setItem("tiao:knowsHowToPlay", "1");
                  setRulesIntroOpen(false);
                  setReadyToJoin(true);
                }}
              >
                {t("startSpectating")}
              </Button>
            )}
          </div>
        </div>
      </Dialog>
    </div>
  );
}
