import { useEffect, useRef, useState } from "react";
import { motion, useAnimationControls } from "framer-motion";
import { toast } from "sonner";
import type { AuthResponse } from "@shared";
import {
  buildWebSocketUrl,
  createMultiplayerGame,
  getMultiplayerGame,
  joinMultiplayerGame,
  listMultiplayerGames,
  resetMultiplayerGame,
} from "@/lib/api";
import { isNetworkError, readableError, toastError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TiaoBoard } from "@/components/game/TiaoBoard";
import { cn } from "@/lib/utils";
import { Navbar, type AuthDialogMode } from "@/components/Navbar";
import { useLocation, useNavigate } from "react-router-dom";
import {
  BOARD_SIZE,
  ClientToServerMessage,
  GameState,
  MultiplayerGameSummary,
  MultiplayerGamesIndex,
  MultiplayerSnapshot,
  PlayerColor,
  Position,
  arePositionsEqual,
  canPlacePiece,
  confirmPendingJump,
  createInitialGameState,
  getJumpTargets,
  getPendingJumpDestination,
  getSelectableJumpOrigins,
  getWinner,
  isGameOver,
  jumpPiece,
  placePiece,
  undoLastTurn,
  undoPendingJumpStep,
} from "@shared";
import { useStonePlacementSound } from "@/lib/useStonePlacementSound";
import { useWinConfetti } from "@/lib/useWinConfetti";

type Mode = "menu" | "local" | "computer" | "multiplayer";
type ConnectionState = "idle" | "connecting" | "connected" | "disconnected";
type MenuTarget = "local" | "computer" | "multiplayer" | null;

type HomePageProps = {
  auth: AuthResponse | null;
  onOpenAuth: (mode: AuthDialogMode) => void;
  onLogout: () => void;
};

type ComputerTurnPlan =
  | {
      type: "place";
      position: Position;
      score: number;
    }
  | {
      type: "jump";
      from: Position;
      path: Position[];
      score: number;
    };

const COMPUTER_COLOR: PlayerColor = "black";
const COMPUTER_THINK_MS = 440;
const ADJACENT_DIRECTIONS = [
  { dx: -1, dy: -1 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: -1, dy: 1 },
  { dx: 0, dy: 1 },
  { dx: 1, dy: 1 },
] as const;

function getPlayerSeat(
  snapshot: MultiplayerSnapshot | null,
  playerId: string | undefined
): PlayerColor | null {
  if (!snapshot || !playerId) {
    return null;
  }

  if (snapshot.seats.white?.player.playerId === playerId) {
    return "white";
  }

  if (snapshot.seats.black?.player.playerId === playerId) {
    return "black";
  }

  return null;
}

function formatPlayerColor(color: PlayerColor | null) {
  if (!color) {
    return null;
  }

  return color.slice(0, 1).toUpperCase() + color.slice(1);
}

function formatGameTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function isSummaryYourTurn(summary: MultiplayerGameSummary) {
  return summary.status === "active" && !!summary.yourSeat && summary.currentTurn === summary.yourSeat;
}

function getOpponentLabel(summary: MultiplayerGameSummary) {
  if (!summary.yourSeat) {
    return "Spectator";
  }

  const opponentColor = summary.yourSeat === "white" ? "black" : "white";
  return summary.seats[opponentColor]?.player.displayName || "Open seat";
}

function getSummaryStatusLabel(summary: MultiplayerGameSummary) {
  if (summary.status === "finished") {
    return `${formatPlayerColor(summary.winner)} won`;
  }

  if (summary.status === "waiting") {
    return "Waiting for player two";
  }

  return isSummaryYourTurn(summary) ? "Your move" : "Opponent to move";
}

function HourglassSpinner({ className }: { className?: string }) {
  return (
    <motion.svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn("h-4 w-4", className)}
      animate={{ rotate: [0, 0, 180, 180, 360] }}
      transition={{
        duration: 2.2,
        ease: "easeInOut",
        repeat: Infinity,
      }}
      fill="none"
    >
      <path
        d="M7 3H17M7 21H17M8 3C8 8 11.5 8.5 12 12C11.5 15.5 8 16 8 21M16 3C16 8 12.5 8.5 12 12C12.5 15.5 16 16 16 21"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </motion.svg>
  );
}

function GamePanelBrand() {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#f6e8cf]/55 bg-[linear-gradient(180deg,#faefd8,#ecd4a6)] font-display text-2xl text-[#25170d] shadow-[0_14px_28px_-18px_rgba(37,23,13,0.85)]">
        跳
      </span>
      <span className="font-display text-3xl tracking-tight text-[#2f2015]">
        Tiao
      </span>
    </div>
  );
}

type AnimatedScoreTileProps = {
  label: string;
  value: number;
  pulseKey: number;
  className: string;
  labelClassName: string;
  valueClassName?: string;
};

function AnimatedScoreTile({
  label,
  value,
  pulseKey,
  className,
  labelClassName,
  valueClassName = "mt-2 text-3xl font-semibold tabular-nums",
}: AnimatedScoreTileProps) {
  const tileControls = useAnimationControls();
  const valueControls = useAnimationControls();

  useEffect(() => {
    if (pulseKey === 0) {
      return;
    }

    tileControls.set({ scale: 1, y: 0 });
    valueControls.set({ scale: 1, y: 0 });

    void tileControls.start({
      scale: [1, 1.06, 0.99, 1.02, 1],
      y: [0, -6, 0, -1.5, 0],
      transition: {
        duration: 0.54,
        times: [0, 0.24, 0.54, 0.78, 1],
        ease: [0.22, 1, 0.36, 1],
      },
    });

    void valueControls.start({
      scale: [1, 1.16, 0.97, 1.06, 1],
      y: [0, -4, 0, -1, 0],
      transition: {
        duration: 0.56,
        times: [0, 0.22, 0.5, 0.78, 1],
        ease: [0.22, 1, 0.36, 1],
      },
    });
  }, [pulseKey, tileControls, valueControls]);

  return (
    <motion.div
      initial={{ scale: 1, y: 0 }}
      animate={tileControls}
      className={className}
      style={{ transformOrigin: "center bottom" }}
    >
      <p className={labelClassName}>{label}</p>
      <motion.p
        initial={{ scale: 1, y: 0 }}
        animate={valueControls}
        className={valueClassName}
      >
        {value}
      </motion.p>
    </motion.div>
  );
}

function distanceFromBoardCenter(position: Position) {
  const center = (BOARD_SIZE - 1) / 2;
  return Math.abs(position.x - center) + Math.abs(position.y - center);
}

function countAdjacentPieces(
  state: GameState,
  position: Position,
  targetColor: PlayerColor
) {
  return ADJACENT_DIRECTIONS.reduce((count, { dx, dy }) => {
    const nextX = position.x + dx;
    const nextY = position.y + dy;

    if (
      nextX < 0 ||
      nextX >= BOARD_SIZE ||
      nextY < 0 ||
      nextY >= BOARD_SIZE
    ) {
      return count;
    }

    return state.positions[nextY][nextX] === targetColor ? count + 1 : count;
  }, 0);
}

function scoreComputerPlacement(state: GameState, position: Position) {
  const centerBias = 24 - distanceFromBoardCenter(position) * 1.85;
  const enemyAdjacency = countAdjacentPieces(state, position, "white") * 2.6;
  const allyAdjacency = countAdjacentPieces(state, position, COMPUTER_COLOR) * 0.9;

  return centerBias + enemyAdjacency + allyAdjacency;
}

function collectComputerJumpPlans(
  state: GameState,
  from: Position
): Array<{ path: Position[]; score: number }> {
  const targets = getJumpTargets(state, from, state.currentTurn);

  if (targets.length === 0) {
    return [];
  }

  return targets.flatMap((target) => {
    const jumped = jumpPiece(state, from, target);
    if (!jumped.ok) {
      return [];
    }

    const continuations = collectComputerJumpPlans(jumped.value, target);
    if (continuations.length > 0) {
      return continuations.map((continuation) => ({
        path: [target, ...continuation.path],
        score: continuation.score,
      }));
    }

    const confirmed = confirmPendingJump(jumped.value);
    if (!confirmed.ok) {
      return [];
    }

    const captures = jumped.value.pendingJump.length;
    const landingPressure = countAdjacentPieces(
      confirmed.value,
      target,
      "white"
    );

    return [
      {
        path: [target],
        score:
          captures * 120 +
          landingPressure * 2.1 -
          distanceFromBoardCenter(target) * 0.9,
      },
    ];
  });
}

function chooseComputerTurn(state: GameState): ComputerTurnPlan | null {
  const jumpOrigins = getSelectableJumpOrigins(state, COMPUTER_COLOR);

  if (jumpOrigins.length > 0) {
    let bestJump: ComputerTurnPlan | null = null;

    for (const origin of jumpOrigins) {
      const plans = collectComputerJumpPlans(state, origin);

      for (const plan of plans) {
        if (!bestJump || plan.score > bestJump.score) {
          bestJump = {
            type: "jump",
            from: origin,
            path: plan.path,
            score: plan.score,
          };
        }
      }
    }

    if (bestJump) {
      return bestJump;
    }
  }

  let bestPlacement: ComputerTurnPlan | null = null;

  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const position = { x, y };
      const placement = canPlacePiece(state, position);

      if (!placement.ok) {
        continue;
      }

      const score = scoreComputerPlacement(state, position);
      if (!bestPlacement || score > bestPlacement.score) {
        bestPlacement = {
          type: "place",
          position,
          score,
        };
      }
    }
  }

  return bestPlacement;
}

function applyComputerTurn(state: GameState) {
  const plan = chooseComputerTurn(state);

  if (!plan) {
    return {
      ok: false as const,
      reason: "The computer could not find a legal move.",
    };
  }

  if (plan.type === "place") {
    return placePiece(state, plan.position);
  }

  let nextState = state;
  let from = plan.from;

  for (const destination of plan.path) {
    const jumped = jumpPiece(nextState, from, destination);
    if (!jumped.ok) {
      return jumped;
    }

    nextState = jumped.value;
    from = destination;
  }

  return confirmPendingJump(nextState);
}

export function HomePage({
  auth,
  onOpenAuth,
  onLogout,
}: HomePageProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const [mode, setMode] = useState<Mode>("menu");
  const [navOpen, setNavOpen] = useState(false);
  const [menuTarget, setMenuTarget] = useState<MenuTarget>(null);

  const [localGame, setLocalGame] = useState<GameState>(() =>
    createInitialGameState()
  );
  const [localSelection, setLocalSelection] = useState<Position | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const [multiplayerSnapshot, setMultiplayerSnapshot] =
    useState<MultiplayerSnapshot | null>(null);
  const [multiplayerSelection, setMultiplayerSelection] =
    useState<Position | null>(null);
  const [multiplayerError, setMultiplayerError] = useState<string | null>(null);
  const [multiplayerBusy, setMultiplayerBusy] = useState(false);
  const [multiplayerGames, setMultiplayerGames] = useState<MultiplayerGamesIndex>({
    active: [],
    finished: [],
  });
  const [multiplayerGamesLoading, setMultiplayerGamesLoading] = useState(false);
  const [multiplayerGamesLoaded, setMultiplayerGamesLoaded] = useState(false);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("idle");
  const [joinGameId, setJoinGameId] = useState("");
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [localConfirmReady, setLocalConfirmReady] = useState(true);
  const [multiplayerConfirmReady, setMultiplayerConfirmReady] = useState(true);
  const [computerThinking, setComputerThinking] = useState(false);
  const [localScorePulse, setLocalScorePulse] = useState<Record<PlayerColor, number>>(
    { black: 0, white: 0 }
  );
  const [multiplayerScorePulse, setMultiplayerScorePulse] = useState<
    Record<PlayerColor, number>
  >({ black: 0, white: 0 });

  const socketRef = useRef<WebSocket | null>(null);
  const localCardRef = useRef<HTMLDivElement | null>(null);
  const computerCardRef = useRef<HTMLDivElement | null>(null);
  const multiplayerCardRef = useRef<HTMLDivElement | null>(null);
  const localHistoryLengthRef = useRef(localGame.history.length);
  const multiplayerHistoryMetaRef = useRef<{ gameId: string | null; length: number }>({
    gameId: null,
    length: 0,
  });
  const multiplayerTurnMetaRef = useRef<{
    gameId: string | null;
    status: MultiplayerSnapshot["status"] | null;
    historyLength: number;
    isYourTurn: boolean;
  }>({
    gameId: null,
    status: null,
    historyLength: 0,
    isYourTurn: false,
  });
  const multiplayerLibraryTurnRef = useRef<
    Map<string, { updatedAt: string; isYourTurn: boolean }>
  >(new Map());

  const localBoardMode = mode === "local" || mode === "computer";
  const computerMode = mode === "computer";
  const accountPlayer = auth?.player.kind === "account";

  useStonePlacementSound(localBoardMode ? localGame : null);
  useStonePlacementSound(
    mode === "multiplayer" ? multiplayerSnapshot?.state ?? null : null
  );

  function applyMultiplayerGamesIndex(
    nextGames: MultiplayerGamesIndex,
    allowTurnToast: boolean
  ) {
    if (allowTurnToast) {
      for (const game of nextGames.active) {
        const previous = multiplayerLibraryTurnRef.current.get(game.gameId);
        const nextIsYourTurn = isSummaryYourTurn(game);

        if (
          previous &&
          !previous.isYourTurn &&
          nextIsYourTurn &&
          multiplayerSnapshot?.gameId !== game.gameId &&
          previous.updatedAt !== game.updatedAt
        ) {
          toast.success(`Your move in room ${game.gameId}`);
        }
      }
    }

    multiplayerLibraryTurnRef.current = new Map(
      nextGames.active.map((game) => [
        game.gameId,
        {
          updatedAt: game.updatedAt,
          isYourTurn: isSummaryYourTurn(game),
        },
      ])
    );

    setMultiplayerGames(nextGames);
    setMultiplayerGamesLoaded(true);
  }

  async function refreshMultiplayerGames(options: {
    silent?: boolean;
    allowTurnToast?: boolean;
  } = {}) {
    if (!auth || auth.player.kind !== "account") {
      setMultiplayerGames({
        active: [],
        finished: [],
      });
      setMultiplayerGamesLoaded(false);
      setMultiplayerGamesLoading(false);
      multiplayerLibraryTurnRef.current.clear();
      return;
    }

    setMultiplayerGamesLoading(true);

    try {
      const response = await listMultiplayerGames(auth.token);
      applyMultiplayerGamesIndex(response.games, options.allowTurnToast ?? false);
    } catch (error) {
      if (!options.silent) {
        toastError(error);
      }
    } finally {
      setMultiplayerGamesLoading(false);
    }
  }

  useEffect(() => {
    return () => {
      socketRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!auth || auth.player.kind !== "account") {
      setMultiplayerGames({
        active: [],
        finished: [],
      });
      setMultiplayerGamesLoaded(false);
      setMultiplayerGamesLoading(false);
      multiplayerLibraryTurnRef.current.clear();
      return;
    }

    void refreshMultiplayerGames({
      silent: true,
      allowTurnToast: false,
    });

    const interval = window.setInterval(() => {
      void refreshMultiplayerGames({
        silent: true,
        allowTurnToast: true,
      });
    }, 25000);

    return () => {
      window.clearInterval(interval);
    };
  }, [auth?.player.kind, auth?.player.playerId, auth?.token]);

  useEffect(() => {
    if (!multiplayerSnapshot) {
      setMultiplayerSelection(null);
      return;
    }

    setMultiplayerSelection(getPendingJumpDestination(multiplayerSnapshot.state));
  }, [multiplayerSnapshot]);

  useEffect(() => {
    if (!copyFeedback) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      setCopyFeedback(null);
    }, 1800);

    return () => window.clearTimeout(timeout);
  }, [copyFeedback]);

  useEffect(() => {
    if (localGame.pendingJump.length === 0) {
      setLocalConfirmReady(true);
      return undefined;
    }

    setLocalConfirmReady(false);
    const timeout = window.setTimeout(() => {
      setLocalConfirmReady(true);
    }, 320);

    return () => window.clearTimeout(timeout);
  }, [localGame.pendingJump.length]);

  useEffect(() => {
    const pendingJumpLength = multiplayerSnapshot?.state.pendingJump.length ?? 0;

    if (pendingJumpLength === 0) {
      setMultiplayerConfirmReady(true);
      return undefined;
    }

    setMultiplayerConfirmReady(false);
    const timeout = window.setTimeout(() => {
      setMultiplayerConfirmReady(true);
    }, 320);

    return () => window.clearTimeout(timeout);
  }, [multiplayerSnapshot?.state.pendingJump.length]);

  useEffect(() => {
    const previousLength = localHistoryLengthRef.current;
    const nextLength = localGame.history.length;

    if (nextLength > previousLength) {
      const latestTurn = localGame.history[nextLength - 1];

      if (latestTurn?.type === "jump") {
        setLocalScorePulse((current) => ({
          ...current,
          [latestTurn.color]: current[latestTurn.color] + 1,
        }));
      }
    }

    localHistoryLengthRef.current = nextLength;
  }, [localGame.history]);

  useEffect(() => {
    const gameId = multiplayerSnapshot?.gameId ?? null;
    const nextLength = multiplayerSnapshot?.state.history.length ?? 0;
    const previousMeta = multiplayerHistoryMetaRef.current;

    if (!gameId) {
      multiplayerHistoryMetaRef.current = { gameId: null, length: 0 };
      return;
    }

    if (previousMeta.gameId !== gameId) {
      multiplayerHistoryMetaRef.current = { gameId, length: nextLength };
      return;
    }

    if (nextLength > previousMeta.length) {
      const latestTurn = multiplayerSnapshot?.state.history[nextLength - 1];

      if (latestTurn?.type === "jump") {
        setMultiplayerScorePulse((current) => ({
          ...current,
          [latestTurn.color]: current[latestTurn.color] + 1,
        }));
      }
    }

    multiplayerHistoryMetaRef.current = { gameId, length: nextLength };
  }, [multiplayerSnapshot]);

  useEffect(() => {
    if (mode !== "menu" || !menuTarget) {
      return undefined;
    }

    const targetRef =
      menuTarget === "local"
        ? localCardRef.current
        : menuTarget === "computer"
          ? computerCardRef.current
          : multiplayerCardRef.current;

    const frame = window.requestAnimationFrame(() => {
      targetRef?.scrollIntoView({ behavior: "smooth", block: "start" });
      setMenuTarget(null);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [mode, menuTarget]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const view = params.get("view");
    if (!view) {
      return;
    }

    if (view === "multiplayer") {
      openMenuSection("multiplayer");
    } else if (view === "computer" || view === "local") {
      openMenuSection("computer");
    } else if (view === "over-the-board") {
      enterLocalMode();
    }

    navigate("/", { replace: true });
  }, [location.search, navigate]);

  const localForcedOrigin = getPendingJumpDestination(localGame);
  const localActiveOrigin = localForcedOrigin ?? localSelection;
  const localJumpTargets = localActiveOrigin
    ? getJumpTargets(localGame, localActiveOrigin, localGame.currentTurn)
    : [];
  const localBoardDisabled =
    computerMode && (computerThinking || localGame.currentTurn === COMPUTER_COLOR);

  const playerSeat = getPlayerSeat(multiplayerSnapshot, auth?.player.playerId);
  const multiplayerForcedOrigin = multiplayerSnapshot
    ? getPendingJumpDestination(multiplayerSnapshot.state)
    : null;
  const multiplayerActiveOrigin = multiplayerForcedOrigin ?? multiplayerSelection;
  const multiplayerJumpTargets =
    multiplayerSnapshot && multiplayerActiveOrigin
      ? getJumpTargets(
          multiplayerSnapshot.state,
          multiplayerActiveOrigin,
          multiplayerSnapshot.state.currentTurn
        )
      : [];
  const multiplayerGameActive =
    multiplayerSnapshot?.status === "active" && !!multiplayerSnapshot.seats.black;
  const multiplayerBoardDisabled =
    !multiplayerSnapshot ||
    !multiplayerGameActive ||
    !playerSeat ||
    multiplayerSnapshot.state.currentTurn !== playerSeat ||
    connectionState !== "connected";

  const paperCard =
    "border-[#d1ba92]/75 bg-[linear-gradient(180deg,rgba(255,250,242,0.97),rgba(245,231,206,0.94))]";
  const boardWrapStyle = {
    maxWidth: "min(100%, calc(100dvh - 1.6rem))",
  } as const;
  const localWinner = getWinner(localGame);
  const multiplayerWinner = multiplayerSnapshot
    ? getWinner(multiplayerSnapshot.state)
    : null;
  const localGameOver = isGameOver(localGame);
  const multiplayerGameOver = multiplayerSnapshot?.status === "finished";
  const localWinnerLabel = formatPlayerColor(localWinner);
  const multiplayerWinnerLabel = formatPlayerColor(multiplayerWinner);
  const localTurnLabel = formatPlayerColor(localGame.currentTurn);
  const localStatusTitle = localGameOver
    ? `${localWinnerLabel} wins`
    : computerMode
      ? computerThinking || localGame.currentTurn === COMPUTER_COLOR
        ? "Computer to move"
        : "Your turn"
      : `${localTurnLabel} to move`;
  const multiplayerYourTurn =
    !!multiplayerSnapshot &&
    !!playerSeat &&
    multiplayerSnapshot.status === "active" &&
    multiplayerSnapshot.state.currentTurn === playerSeat &&
    connectionState === "connected";
  const multiplayerWaitingOnOpponent =
    !!multiplayerSnapshot &&
    !!playerSeat &&
    multiplayerSnapshot.status === "active" &&
    multiplayerSnapshot.state.currentTurn !== playerSeat &&
    connectionState === "connected";
  const multiplayerWaitingForOpponentSeat =
    multiplayerSnapshot?.status === "waiting";
  const multiplayerReconnectAvailable =
    !!multiplayerSnapshot && connectionState === "disconnected";
  const multiplayerStatusTitle = !multiplayerSnapshot
    ? "Room"
    : multiplayerGameOver
      ? `${multiplayerWinnerLabel} wins`
      : multiplayerWaitingForOpponentSeat
        ? "Waiting for player two"
        : multiplayerYourTurn
          ? "Your move"
          : multiplayerWaitingOnOpponent
            ? "Opponent to move"
            : connectionState === "disconnected"
              ? "Reconnecting needed"
              : "Live match";

  useWinConfetti(localBoardMode ? localWinner : null);
  useWinConfetti(mode === "multiplayer" ? multiplayerWinner : null);

  useEffect(() => {
    const nextMeta = {
      gameId: multiplayerSnapshot?.gameId ?? null,
      status: multiplayerSnapshot?.status ?? null,
      historyLength: multiplayerSnapshot?.state.history.length ?? 0,
      isYourTurn: multiplayerYourTurn,
    };
    const previousMeta = multiplayerTurnMetaRef.current;

    if (
      nextMeta.gameId &&
      nextMeta.isYourTurn &&
      previousMeta.gameId === nextMeta.gameId &&
      !previousMeta.isYourTurn &&
      (nextMeta.historyLength > previousMeta.historyLength ||
        (previousMeta.status === "waiting" && nextMeta.status === "active"))
    ) {
      toast.success(`Your move in room ${nextMeta.gameId}`);
    }

    multiplayerTurnMetaRef.current = nextMeta;
  }, [multiplayerSnapshot, multiplayerYourTurn]);

  useEffect(() => {
    if (
      !computerMode ||
      localGame.currentTurn !== COMPUTER_COLOR ||
      localGame.pendingJump.length > 0 ||
      isGameOver(localGame) ||
      computerThinking
    ) {
      return undefined;
    }

    setComputerThinking(true);
    const timeout = window.setTimeout(() => {
      const result = applyComputerTurn(localGame);

      if (result.ok) {
        setLocalGame(result.value);
        setLocalSelection(null);
        setLocalError(null);
      } else {
        setLocalError(result.reason);
      }

      setComputerThinking(false);
    }, COMPUTER_THINK_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [computerMode, computerThinking, localGame]);

  useEffect(() => {
    if (!multiplayerError) {
      return;
    }

    toastError(multiplayerError);
    setMultiplayerError(null);
  }, [multiplayerError]);

  useEffect(() => {
    if (!localError) {
      return;
    }

    toastError(localError);
    setLocalError(null);
  }, [localError]);

  function closeMultiplayerConnection() {
    socketRef.current?.close();
    socketRef.current = null;
    setConnectionState("idle");
  }

  function clearMultiplayerView() {
    closeMultiplayerConnection();
    setMultiplayerSnapshot(null);
    setMultiplayerSelection(null);
    setMultiplayerError(null);
    setCopyFeedback(null);
    setMultiplayerScorePulse({ black: 0, white: 0 });
    multiplayerHistoryMetaRef.current = { gameId: null, length: 0 };
    multiplayerTurnMetaRef.current = {
      gameId: null,
      status: null,
      historyLength: 0,
      isYourTurn: false,
    };
  }

  function resetLocalGame() {
    setLocalGame(createInitialGameState());
    setLocalSelection(null);
    setLocalError(null);
    setComputerThinking(false);
    setLocalScorePulse({ black: 0, white: 0 });
    localHistoryLengthRef.current = 0;
  }

  function handleLocalUndoPendingJump() {
    const result = undoPendingJumpStep(localGame);
    if (result.ok) {
      setLocalGame(result.value);
      setLocalSelection(getPendingJumpDestination(result.value));
      setLocalError(null);
    } else {
      setLocalError(result.reason);
    }
  }

  function handleLocalConfirmPendingJump() {
    const result = confirmPendingJump(localGame);
    if (result.ok) {
      setLocalGame(result.value);
      setLocalSelection(null);
      setLocalError(null);
    } else {
      setLocalError(result.reason);
    }
  }

  function handleLocalUndoTurn() {
    let nextState = localGame;
    const undoCount =
      computerMode && localGame.currentTurn === "white" ? 2 : 1;

    for (let index = 0; index < undoCount; index += 1) {
      const result = undoLastTurn(nextState);
      if (!result.ok) {
        setLocalError(result.reason);
        return;
      }

      nextState = result.value;
    }

    setLocalGame(nextState);
    setLocalSelection(null);
    setLocalError(null);
  }

  function goHome() {
    clearMultiplayerView();
    setComputerThinking(false);
    setMode("menu");
    setNavOpen(false);
  }

  function openMenuSection(section: Exclude<MenuTarget, null>) {
    clearMultiplayerView();
    setMode("menu");
    setMenuTarget(section);
    setNavOpen(false);
  }

  function enterLocalMode() {
    clearMultiplayerView();
    resetLocalGame();
    setMode("local");
    setNavOpen(false);
  }

  function enterComputerMode() {
    clearMultiplayerView();
    resetLocalGame();
    setMode("computer");
    setNavOpen(false);
  }

  function openProfilePage() {
    setNavOpen(false);
    navigate("/profile");
  }

  function handleMultiplayerNav() {
    if (mode === "multiplayer") {
      setNavOpen(false);
      return;
    }

    openMenuSection("multiplayer");
  }

  function handleComputerNav() {
    if (mode === "menu") {
      openMenuSection("computer");
      return;
    }

    setNavOpen(false);
    goHome();
    setMenuTarget("computer");
  }

  function handleLocalBoardClick(position: Position) {
    setLocalError(null);

    if (isGameOver(localGame)) {
      return;
    }

    const tile = localGame.positions[position.y][position.x];
    const activeOrigin = localForcedOrigin ?? localSelection;
    const jumpTargets = activeOrigin
      ? getJumpTargets(localGame, activeOrigin, localGame.currentTurn)
      : [];

    if (
      localGame.pendingJump.length > 0 &&
      localForcedOrigin &&
      arePositionsEqual(localForcedOrigin, position)
    ) {
      if (!localConfirmReady) {
        setLocalSelection(localForcedOrigin);
        return;
      }

      handleLocalConfirmPendingJump();
      return;
    }

    if (
      activeOrigin &&
      jumpTargets.some((target) => arePositionsEqual(target, position))
    ) {
      const result = jumpPiece(localGame, activeOrigin, position);
      if (!result.ok) {
        setLocalError(result.reason);
        return;
      }

      setLocalGame(result.value);
      setLocalSelection(position);
      return;
    }

    if (tile === localGame.currentTurn) {
      const selectionAllowed =
        !localForcedOrigin || arePositionsEqual(localForcedOrigin, position);
      const targets = selectionAllowed
        ? getJumpTargets(localGame, position, localGame.currentTurn)
        : [];

      if (targets.length > 0) {
        setLocalSelection(position);
        return;
      }
    }

    if (tile === null && !localForcedOrigin) {
      const result = placePiece(localGame, position);
      if (!result.ok) {
        setLocalError(result.reason);
        return;
      }

      setLocalGame(result.value);
      setLocalSelection(null);
      return;
    }

    setLocalSelection(localForcedOrigin);
  }

  function sendMultiplayerMessage(message: ClientToServerMessage) {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      setMultiplayerError("Connection not ready.");
      return;
    }

    socketRef.current.send(JSON.stringify(message));
  }

  function handleMultiplayerBoardClick(position: Position) {
    if (!multiplayerSnapshot || !playerSeat || multiplayerBoardDisabled) {
      return;
    }

    setMultiplayerError(null);

    const state = multiplayerSnapshot.state;
    const tile = state.positions[position.y][position.x];
    const activeOrigin = multiplayerForcedOrigin ?? multiplayerSelection;
    const jumpTargets = activeOrigin
      ? getJumpTargets(state, activeOrigin, state.currentTurn)
      : [];

    if (
      state.pendingJump.length > 0 &&
      multiplayerForcedOrigin &&
      arePositionsEqual(multiplayerForcedOrigin, position)
    ) {
      if (!multiplayerConfirmReady) {
        setMultiplayerSelection(multiplayerForcedOrigin);
        return;
      }

      sendMultiplayerMessage({ type: "confirm-jump" });
      return;
    }

    if (
      activeOrigin &&
      jumpTargets.some((target) => arePositionsEqual(target, position))
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
      const selectionAllowed =
        !multiplayerForcedOrigin ||
        arePositionsEqual(multiplayerForcedOrigin, position);
      const targets = selectionAllowed
        ? getJumpTargets(state, position, state.currentTurn)
        : [];

      if (targets.length > 0) {
        setMultiplayerSelection(position);
        return;
      }
    }

    if (tile === null && !multiplayerForcedOrigin) {
      sendMultiplayerMessage({
        type: "place-piece",
        position,
      });
      setMultiplayerSelection(null);
      return;
    }

    setMultiplayerSelection(multiplayerForcedOrigin);
  }

  function connectToRoom(snapshot: MultiplayerSnapshot, nextAuth: AuthResponse) {
    clearMultiplayerView();

    const socket = new WebSocket(
      buildWebSocketUrl(snapshot.gameId, nextAuth.token)
    );

    setConnectionState("connecting");
    socketRef.current = socket;
    setMultiplayerSnapshot(snapshot);

    socket.addEventListener("open", () => {
      setConnectionState("connected");
    });

    socket.addEventListener("message", (event) => {
      const payload = JSON.parse(event.data as string) as
        | {
            type: "snapshot";
            snapshot: MultiplayerSnapshot;
          }
        | {
            type: "error";
            message: string;
          };

      if (payload.type === "snapshot") {
        setMultiplayerSnapshot(payload.snapshot);
        setMultiplayerError(null);
        return;
      }

      setMultiplayerError(payload.message);
    });

    socket.addEventListener("close", () => {
      setConnectionState("disconnected");
    });

    socket.addEventListener("error", () => {
      setConnectionState("disconnected");
      setMultiplayerError("Connection dropped.");
    });
  }

  async function openExistingMultiplayerGame(gameId: string) {
    if (!auth) {
      setMultiplayerError("Player session unavailable.");
      return;
    }

    setMultiplayerBusy(true);
    setMultiplayerError(null);

    try {
      const response = await getMultiplayerGame(auth.token, gameId);
      setMode("multiplayer");
      setMultiplayerSelection(null);
      connectToRoom(response.snapshot, auth);
      if (accountPlayer) {
        void refreshMultiplayerGames({ silent: true });
      }
    } catch (error) {
      if (isNetworkError(error)) {
        toastError(error);
      } else {
        setMultiplayerError(readableError(error));
      }
    } finally {
      setMultiplayerBusy(false);
    }
  }

  async function handleCreateRoom() {
    if (!auth) {
      setMultiplayerError("Player session unavailable.");
      return;
    }

    setMultiplayerBusy(true);
    setMultiplayerError(null);

    try {
      const response = await createMultiplayerGame(auth.token);
      setMode("multiplayer");
      setMultiplayerSelection(null);
      connectToRoom(response.snapshot, auth);
      if (accountPlayer) {
        void refreshMultiplayerGames({ silent: true });
      }
    } catch (error) {
      if (isNetworkError(error)) {
        toastError(error);
      } else {
        setMultiplayerError(readableError(error));
      }
    } finally {
      setMultiplayerBusy(false);
    }
  }

  async function handleJoinRoom() {
    if (!auth) {
      setMultiplayerError("Player session unavailable.");
      return;
    }

    if (!joinGameId.trim()) {
      setMultiplayerError("Enter a game ID.");
      return;
    }

    setMultiplayerBusy(true);
    setMultiplayerError(null);

    try {
      const response = await joinMultiplayerGame(auth.token, joinGameId.trim());
      setMode("multiplayer");
      setMultiplayerSelection(null);
      connectToRoom(response.snapshot, auth);
      if (accountPlayer) {
        void refreshMultiplayerGames({ silent: true });
      }
    } catch (error) {
      if (isNetworkError(error)) {
        toastError(error);
      } else {
        setMultiplayerError(readableError(error));
      }
    } finally {
      setMultiplayerBusy(false);
    }
  }

  async function handleCopyGameId() {
    if (!multiplayerSnapshot) {
      return;
    }

    try {
      await navigator.clipboard.writeText(multiplayerSnapshot.gameId);
      setCopyFeedback("Copied");
    } catch {
      setCopyFeedback("Copy failed");
    }
  }

  async function handleResetMultiplayerBoard() {
    if (!auth || !multiplayerSnapshot) {
      return;
    }

    setMultiplayerBusy(true);

    try {
      const response = await resetMultiplayerGame(auth.token, multiplayerSnapshot.gameId);
      setMultiplayerSnapshot(response.snapshot);
      setMultiplayerSelection(null);
      if (accountPlayer) {
        void refreshMultiplayerGames({ silent: true });
      }
    } catch (error) {
      if (isNetworkError(error)) {
        toastError(error);
      } else {
        setMultiplayerError(readableError(error));
      }
    } finally {
      setMultiplayerBusy(false);
    }
  }

  function handleMultiplayerUndoPendingJump() {
    sendMultiplayerMessage({ type: "undo-pending-jump-step" });
  }

  async function handleReconnectMultiplayerRoom() {
    if (!multiplayerSnapshot) {
      return;
    }

    await openExistingMultiplayerGame(multiplayerSnapshot.gameId);
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[18rem] bg-[radial-gradient(circle_at_top,_rgba(255,247,231,0.76),_transparent_58%)]" />

      <Navbar
        mode={mode === "menu" ? "lobby" : mode}
        auth={auth}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen((value) => !value)}
        onCloseNav={() => setNavOpen(false)}
        onGoLobby={goHome}
        onGoOverTheBoard={enterLocalMode}
        onGoMultiplayer={handleMultiplayerNav}
        onGoComputer={handleComputerNav}
        onGoProfile={openProfilePage}
        onOpenAuth={onOpenAuth}
        onLogout={onLogout}
      />

      <main
        className={cn(
          "mx-auto flex flex-col gap-5 px-4 sm:px-6",
          mode === "menu"
            ? "max-w-7xl pb-5 pt-20 lg:px-8 lg:pb-6 lg:pt-20"
            : "max-w-[104rem] pt-16 pb-3 sm:pt-5 lg:px-6 lg:pb-4 xl:pt-2"
        )}
      >
        {mode === "menu" ? (
          <>
            <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="grid gap-5">
              <motion.div
                ref={localCardRef}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <Card className={cn("overflow-hidden", paperCard)}>
                  <div className="h-2 bg-[linear-gradient(90deg,#4b3726,#b98d49)]" />
                  <CardHeader>
                    <Badge className="w-fit bg-[#f4e8d2] text-[#6c543c]">
                      Local
                    </Badge>
                    <CardTitle className="text-4xl text-[#2b1e14]">
                      Over the board
                    </CardTitle>
                    <CardDescription className="text-[#6e5b48]">
                      Start a shared-board match with a clean, focused table view.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Button size="lg" className="w-full" onClick={enterLocalMode}>
                      Start local game
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div
                ref={computerCardRef}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <Card className={cn("overflow-hidden", paperCard)}>
                  <div className="h-2 bg-[linear-gradient(90deg,#3c5a28,#94ba69)]" />
                  <CardHeader>
                    <Badge className="w-fit bg-[#edf5e4] text-[#486334]">
                      Against computer
                    </Badge>
                    <CardTitle className="text-4xl text-[#2b1e14]">
                      Solo board
                    </CardTitle>
                    <CardDescription className="text-[#6e5b48]">
                      Play white, take the first move, and let the computer answer.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Button size="lg" className="w-full" onClick={enterComputerMode}>
                      Play against AI
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
            </div>

            <motion.div
              ref={multiplayerCardRef}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Card className={cn("overflow-hidden", paperCard)}>
                <div className="h-2 bg-[linear-gradient(90deg,#1f1a16,#8d6a39)]" />
                <CardHeader>
                  <Badge className="w-fit bg-[#eee3cf] text-[#5f4932]">
                    Multiplayer
                  </Badge>
                  <CardTitle className="text-4xl text-[#2b1e14]">
                    Invite room
                  </CardTitle>
                  <CardDescription className="text-[#6e5b48]">
                    Create a room, share the code, or join one in progress.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="rounded-3xl border border-[#dbc59f] bg-[#fff9ef] p-4">
                    <p className="mb-3 text-sm font-medium text-[#5b4835]">
                      Start a fresh room
                    </p>
                    <Button
                      size="lg"
                      className="w-full"
                      onClick={handleCreateRoom}
                      disabled={multiplayerBusy || !auth}
                    >
                      {multiplayerBusy ? "Creating..." : "Create room"}
                    </Button>
                  </div>

                  <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.28em] text-[#8d7760]">
                    <span className="h-px flex-1 bg-[#dcc7a2]" />
                    Join existing room
                    <span className="h-px flex-1 bg-[#dcc7a2]" />
                  </div>

                  <div className="space-y-3 rounded-3xl border border-[#dbc59f] bg-[#fff9ef] p-4">
                    <label className="text-sm font-medium text-[#5b4835]">
                      Room code
                    </label>
                    <Input
                      value={joinGameId}
                      onChange={(event) =>
                        setJoinGameId(
                          event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "")
                        )
                      }
                      placeholder="Game ID"
                      maxLength={6}
                    />
                    <Button
                      variant="secondary"
                      className="w-full"
                      onClick={handleJoinRoom}
                      disabled={multiplayerBusy || !auth}
                    >
                      Join room
                    </Button>
                  </div>

                  <div className="rounded-3xl border border-dashed border-[#d9c4a0] bg-[#fffbf3] px-4 py-3 text-sm text-[#6e5b48]">
                    {accountPlayer ? (
                      <p>
                        Account players can keep multiple live tables, reopen them from the
                        lobby, and browse finished matches later.
                      </p>
                    ) : (
                      <p>
                        Guest players can keep one unfinished multiplayer game at a time.
                        Sign in to juggle multiple tables and unlock match history.
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
            </section>

            {accountPlayer ? (
              <section className="grid gap-5 xl:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
                  <Card className={cn("overflow-hidden", paperCard)}>
                    <div className="h-2 bg-[linear-gradient(90deg,#6e4f29,#d2a661)]" />
                    <CardHeader className="gap-3">
                      <Badge className="w-fit bg-[#f5ead8] text-[#6e5437]">
                        Ongoing games
                      </Badge>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <CardTitle className="text-3xl text-[#2b1e14]">
                            Active tables
                          </CardTitle>
                          <CardDescription className="text-[#6e5b48]">
                            Jump between your live rooms and spot where it is your move.
                          </CardDescription>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void refreshMultiplayerGames()}
                          disabled={multiplayerGamesLoading}
                        >
                          {multiplayerGamesLoading ? "Refreshing..." : "Refresh"}
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {!multiplayerGamesLoaded && multiplayerGamesLoading ? (
                        <div className="rounded-3xl border border-[#dbc59f] bg-[#fff9ef] px-4 py-5 text-sm text-[#6e5b48]">
                          Loading your active tables...
                        </div>
                      ) : multiplayerGames.active.length === 0 ? (
                        <div className="rounded-3xl border border-[#dbc59f] bg-[#fff9ef] px-4 py-5 text-sm text-[#6e5b48]">
                          No active games yet. Create a room or join a friend to start building
                          your table list.
                        </div>
                      ) : (
                        multiplayerGames.active.map((game) => (
                          <div
                            key={game.gameId}
                            className={cn(
                              "rounded-[1.65rem] border px-4 py-4 shadow-[0_18px_36px_-30px_rgba(56,36,20,0.4)]",
                              isSummaryYourTurn(game)
                                ? "border-[#a7c07b] bg-[linear-gradient(180deg,#fbfff4,#eef6df)]"
                                : game.status === "waiting"
                                  ? "border-[#dcc59f] bg-[linear-gradient(180deg,#fffaf2,#f7eddc)]"
                                  : "border-[#d7c39e] bg-[linear-gradient(180deg,#fffaf3,#f5eee2)]"
                            )}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="flex items-center gap-2">
                                  <p className="font-mono text-lg font-semibold tracking-[0.08em] text-[#2b1e14]">
                                    {game.gameId}
                                  </p>
                                  <Badge
                                    className={cn(
                                      isSummaryYourTurn(game)
                                        ? "bg-[#e8f2d8] text-[#4b6537]"
                                        : game.status === "waiting"
                                          ? "bg-[#f3e7d5] text-[#6b563e]"
                                          : "bg-[#efe3cf] text-[#5f4932]"
                                    )}
                                  >
                                    {getSummaryStatusLabel(game)}
                                  </Badge>
                                </div>
                                <p className="mt-2 text-sm text-[#6e5b48]">
                                  Opponent:{" "}
                                  <span className="font-semibold text-[#2b1e14]">
                                    {getOpponentLabel(game)}
                                  </span>
                                </p>
                                <p className="mt-1 text-sm text-[#7a6656]">
                                  Score {game.score.white}-{game.score.black} • Updated{" "}
                                  {formatGameTimestamp(game.updatedAt)}
                                </p>
                              </div>
                              <Button
                                size="sm"
                                onClick={() => void openExistingMultiplayerGame(game.gameId)}
                                disabled={multiplayerBusy}
                              >
                                Open
                              </Button>
                            </div>
                          </div>
                        ))
                      )}
                    </CardContent>
                  </Card>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
                  <Card className={cn("overflow-hidden", paperCard)}>
                    <div className="h-2 bg-[linear-gradient(90deg,#45311f,#af7b4a)]" />
                    <CardHeader>
                      <Badge className="w-fit bg-[#f2e6d4] text-[#72533a]">
                        Match history
                      </Badge>
                      <CardTitle className="text-3xl text-[#2b1e14]">
                        Finished games
                      </CardTitle>
                      <CardDescription className="text-[#6e5b48]">
                        Reopen completed boards and keep a running archive of your tables.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {!multiplayerGamesLoaded && multiplayerGamesLoading ? (
                        <div className="rounded-3xl border border-[#dbc59f] bg-[#fff9ef] px-4 py-5 text-sm text-[#6e5b48]">
                          Loading your archive...
                        </div>
                      ) : multiplayerGames.finished.length === 0 ? (
                        <div className="rounded-3xl border border-[#dbc59f] bg-[#fff9ef] px-4 py-5 text-sm text-[#6e5b48]">
                          Finished matches will land here once a room reaches the win score.
                        </div>
                      ) : (
                        multiplayerGames.finished.map((game) => (
                          <div
                            key={game.gameId}
                            className="rounded-[1.65rem] border border-[#d7c39e] bg-[linear-gradient(180deg,#fffaf3,#f4ece0)] px-4 py-4 shadow-[0_18px_36px_-30px_rgba(56,36,20,0.4)]"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="flex items-center gap-2">
                                  <p className="font-mono text-lg font-semibold tracking-[0.08em] text-[#2b1e14]">
                                    {game.gameId}
                                  </p>
                                  <Badge className="bg-[#efe3cf] text-[#5f4932]">
                                    {getSummaryStatusLabel(game)}
                                  </Badge>
                                </div>
                                <p className="mt-2 text-sm text-[#6e5b48]">
                                  Opponent:{" "}
                                  <span className="font-semibold text-[#2b1e14]">
                                    {getOpponentLabel(game)}
                                  </span>
                                </p>
                                <p className="mt-1 text-sm text-[#7a6656]">
                                  {game.historyLength} turns • Finished{" "}
                                  {formatGameTimestamp(game.updatedAt)}
                                </p>
                              </div>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => void openExistingMultiplayerGame(game.gameId)}
                                disabled={multiplayerBusy}
                              >
                                View board
                              </Button>
                            </div>
                          </div>
                        ))
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              </section>
            ) : null}
          </>
        ) : null}

        {localBoardMode ? (
          <section className="grid gap-3 xl:gap-1.5 xl:grid-cols-[minmax(0,1fr)_17.75rem] xl:items-start">
            <div className="flex justify-center xl:min-h-[calc(100dvh-1.5rem)]">
              <div className="mx-auto w-full" style={boardWrapStyle}>
                <TiaoBoard
                  state={localGame}
                  selectedPiece={localSelection}
                  jumpTargets={localJumpTargets}
                  confirmReady={localConfirmReady}
                  disabled={localBoardDisabled}
                  onPointClick={handleLocalBoardClick}
                  onUndoLastJump={handleLocalUndoPendingJump}
                />
              </div>
            </div>

            <div className="space-y-4 xl:max-h-[calc(100dvh-1.5rem)] xl:overflow-auto">
              <div className="mx-auto w-full xl:mx-0" style={boardWrapStyle}>
                <Card className={paperCard}>
                  <CardHeader>
                    <GamePanelBrand />
                    {computerMode ? (
                      <Badge className="w-fit bg-[#edf5e4] text-[#486334]">
                        Against computer
                      </Badge>
                    ) : null}
                    <CardTitle className="text-[#2b1e14]">
                      {localStatusTitle}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <AnimatedScoreTile
                        label="Black"
                        value={localGame.score.black}
                        pulseKey={localScorePulse.black}
                        className="rounded-3xl border border-black/10 bg-[linear-gradient(180deg,#39312b,#14100d)] p-4 text-[#f9f2e8] shadow-[0_18px_32px_-26px_rgba(0,0,0,0.9)]"
                        labelClassName="text-xs uppercase tracking-[0.24em] text-[#d9cec2]"
                      />
                      <AnimatedScoreTile
                        label="White"
                        value={localGame.score.white}
                        pulseKey={localScorePulse.white}
                        className="rounded-3xl border border-[#d3c3ad] bg-[linear-gradient(180deg,#fffef8,#efe4d1)] p-4 text-[#2b1e14] shadow-[0_18px_32px_-26px_rgba(84,61,36,0.45)]"
                        labelClassName="text-xs uppercase tracking-[0.24em] text-[#847261]"
                      />
                    </div>

                    <div className="grid gap-2">
                      <Button
                        variant="secondary"
                        onClick={handleLocalUndoTurn}
                        disabled={localBoardDisabled}
                      >
                        Undo turn
                      </Button>
                      {localGame.pendingJump.length > 0 ? (
                        <Button
                          variant="outline"
                          onClick={handleLocalUndoPendingJump}
                          disabled={localBoardDisabled}
                        >
                          Undo jump
                        </Button>
                      ) : null}
                      {localGame.pendingJump.length > 0 ? (
                        <Button
                          onClick={handleLocalConfirmPendingJump}
                          disabled={localBoardDisabled}
                        >
                          Confirm jump
                        </Button>
                      ) : null}
                    </div>

                    {localGameOver ? (
                      <div className="grid gap-2 border-t border-[#dbc6a2] pt-4">
                        <Button variant="secondary" onClick={resetLocalGame}>
                          Restart board
                        </Button>
                        <Button variant="ghost" onClick={goHome}>
                          Back to lobby
                        </Button>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              </div>
            </div>
          </section>
        ) : null}

        {mode === "multiplayer" ? (
          <section className="grid gap-3 xl:gap-1.5 xl:grid-cols-[minmax(0,1fr)_17.75rem] xl:items-start">
            <div className="flex justify-center xl:min-h-[calc(100dvh-1.5rem)]">
              <div
                className={cn(
                  "relative mx-auto w-full",
                  multiplayerYourTurn ? "cursor-default" : "cursor-wait"
                )}
                style={boardWrapStyle}
              >
                {multiplayerSnapshot ? (
                  <TiaoBoard
                    state={multiplayerSnapshot.state}
                    selectedPiece={multiplayerSelection}
                    jumpTargets={multiplayerJumpTargets}
                    confirmReady={multiplayerConfirmReady}
                    onPointClick={handleMultiplayerBoardClick}
                    disabled={multiplayerBoardDisabled}
                    onUndoLastJump={handleMultiplayerUndoPendingJump}
                  />
                ) : null}

                {multiplayerWaitingOnOpponent ? (
                  <div className="pointer-events-none absolute right-3 top-3 z-[96] flex items-center gap-2 rounded-full border border-[#d8c29c] bg-[#fff8ee]/96 px-3 py-2 text-sm font-semibold text-[#5d4732] shadow-[0_16px_28px_-22px_rgba(67,45,24,0.5)] backdrop-blur">
                    <HourglassSpinner className="text-[#7b5f3f]" />
                    Waiting for opponent
                  </div>
                ) : null}

                {multiplayerYourTurn ? (
                  <div className="pointer-events-none absolute right-3 top-3 z-[96] rounded-full border border-[#b8cc8f] bg-[#f7fce9]/96 px-3 py-2 text-sm font-semibold text-[#56703f] shadow-[0_16px_28px_-22px_rgba(63,92,32,0.42)] backdrop-blur">
                    Your move
                  </div>
                ) : null}

                {multiplayerSnapshot?.status === "waiting" ? (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="flex items-center gap-3 rounded-3xl border border-[#dcc7a2] bg-[#fff7ec]/92 px-5 py-3 text-sm font-semibold text-[#5d4732] shadow-lg backdrop-blur">
                      <HourglassSpinner className="text-[#7b5f3f]" />
                      Waiting for player two
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="space-y-4 xl:max-h-[calc(100dvh-1.5rem)] xl:overflow-auto">
              <div className="mx-auto w-full xl:mx-0" style={boardWrapStyle}>
                <Card
                  className={cn(
                    paperCard,
                    multiplayerYourTurn &&
                      "border-[#b7cb8d] bg-[linear-gradient(180deg,rgba(251,255,243,0.98),rgba(240,248,224,0.96))]",
                    multiplayerWaitingOnOpponent &&
                      "border-[#d5c19f] bg-[linear-gradient(180deg,rgba(255,251,244,0.98),rgba(247,236,214,0.95))]"
                  )}
                >
                  <CardHeader>
                    <GamePanelBrand />
                    <Badge className="w-fit bg-[#eee3cf] text-[#5f4932]">
                      Multiplayer
                    </Badge>
                    <CardTitle className="text-[#2b1e14]">
                      {multiplayerSnapshot
                        ? `Room ${multiplayerSnapshot.gameId}`
                        : "Room"}
                    </CardTitle>
                    <CardDescription
                      className={cn(
                        multiplayerYourTurn
                          ? "font-semibold text-[#56703f]"
                          : "text-[#6e5b48]"
                      )}
                    >
                      {multiplayerStatusTitle}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {multiplayerSnapshot ? (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="rounded-2xl border border-black/10 bg-[linear-gradient(180deg,#39312b,#16110d)] px-4 py-2 font-mono text-xl text-[#f9f2e8] shadow-[0_18px_32px_-26px_rgba(0,0,0,0.9)]">
                            {multiplayerSnapshot.gameId}
                          </div>
                          <Button variant="secondary" onClick={handleCopyGameId}>
                            Copy
                          </Button>
                          {copyFeedback ? (
                            <span className="text-sm text-[#7a6656]">
                              {copyFeedback}
                            </span>
                          ) : null}
                        </div>

                        <div className="grid gap-2">
                          {(["white", "black"] as PlayerColor[]).map((color) => {
                            const seat = multiplayerSnapshot.seats[color];
                            return (
                              <div
                                key={color}
                                className="flex items-center justify-between rounded-3xl border border-[#d8c29c] bg-[#fffaf1] px-4 py-3"
                              >
                                <div>
                                  <p className="text-sm font-semibold capitalize text-[#2b1e14]">
                                    {color}
                                  </p>
                                  <p className="text-sm text-[#7a6656]">
                                    {seat?.player.displayName || "Open"}
                                  </p>
                                </div>
                                <Badge
                                  className={cn(
                                    seat?.online
                                      ? "bg-[#eef2e8] text-[#43513f]"
                                      : "bg-[#f2e8d9] text-[#6e5b48]"
                                  )}
                                >
                                  {seat?.online ? "Online" : "Offline"}
                                </Badge>
                              </div>
                            );
                          })}
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <AnimatedScoreTile
                            label="Black"
                            value={multiplayerSnapshot.state.score.black}
                            pulseKey={multiplayerScorePulse.black}
                            className="rounded-3xl border border-black/10 bg-[linear-gradient(180deg,#39312b,#14100d)] p-4 text-[#f9f2e8] shadow-[0_18px_32px_-26px_rgba(0,0,0,0.9)]"
                            labelClassName="text-xs uppercase tracking-[0.24em] text-[#d9cec2]"
                          />
                          <AnimatedScoreTile
                            label="White"
                            value={multiplayerSnapshot.state.score.white}
                            pulseKey={multiplayerScorePulse.white}
                            className="rounded-3xl border border-[#d3c3ad] bg-[linear-gradient(180deg,#fffef8,#efe4d1)] p-4 text-[#2b1e14] shadow-[0_18px_32px_-26px_rgba(84,61,36,0.45)]"
                            labelClassName="text-xs uppercase tracking-[0.24em] text-[#847261]"
                          />
                        </div>

                        <div
                          className={cn(
                            "rounded-3xl border px-4 py-3 text-sm",
                            multiplayerYourTurn
                              ? "border-[#bdd297] bg-[#f6fde8] text-[#5a7242]"
                              : multiplayerWaitingOnOpponent
                                ? "border-[#dcc59f] bg-[#fff7ea] text-[#6a553d]"
                                : "border-[#d8c29c] bg-[#fffaf1] text-[#6e5b48]"
                          )}
                        >
                          <p>
                            You:{" "}
                            <span className="font-semibold text-[#2b1e14]">
                              {playerSeat || "spectator"}
                            </span>
                          </p>
                          <p>
                            Status:{" "}
                            <span className="font-semibold text-[#2b1e14]">
                              {connectionState}
                            </span>
                          </p>
                          <p>
                            {multiplayerSnapshot.status === "waiting"
                              ? "Room open."
                              : multiplayerSnapshot.status === "finished"
                              ? `${multiplayerWinnerLabel} won.`
                              : multiplayerYourTurn
                                ? "The board is yours."
                                : `${formatPlayerColor(multiplayerSnapshot.state.currentTurn)} to move.`}
                          </p>
                        </div>

                        <div className="grid gap-2">
                          {multiplayerReconnectAvailable ? (
                            <Button
                              variant="secondary"
                              onClick={() => void handleReconnectMultiplayerRoom()}
                              disabled={multiplayerBusy}
                            >
                              {multiplayerBusy ? "Reconnecting..." : "Reconnect room"}
                            </Button>
                          ) : null}
                          {multiplayerSnapshot.state.pendingJump.length > 0 ? (
                            <Button
                              onClick={() =>
                                sendMultiplayerMessage({ type: "confirm-jump" })
                              }
                              disabled={multiplayerBoardDisabled}
                            >
                              Confirm jump
                            </Button>
                          ) : null}
                        </div>

                        {multiplayerGameOver ? (
                          <div className="grid gap-2 border-t border-[#dbc6a2] pt-4">
                            <Button
                              variant="secondary"
                              onClick={handleResetMultiplayerBoard}
                              disabled={multiplayerBusy}
                            >
                              {multiplayerBusy ? "Restarting..." : "Restart board"}
                            </Button>
                            <Button variant="ghost" onClick={goHome}>
                              Back to lobby
                            </Button>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </CardContent>
                </Card>
              </div>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
