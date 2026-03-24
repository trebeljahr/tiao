import { useEffect, useRef, useState } from "react";
import { motion, useAnimationControls } from "framer-motion";
import { toast } from "sonner";
import type { AuthResponse } from "@shared";
import {
  accessMultiplayerGame,
  acceptFriendRequest,
  buildWebSocketUrl,
  cancelFriendRequest,
  createMultiplayerGame,
  enterMatchmaking,
  getMatchmakingState,
  getMultiplayerGame,
  getSocialOverview,
  joinMultiplayerGame,
  leaveMatchmaking,
  listMultiplayerGames,
  revokeGameInvitation,
  searchPlayers,
  sendFriendRequest,
  sendGameInvitation,
  declineFriendRequest,
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
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  BOARD_SIZE,
  ClientToServerMessage,
  GameState,
  MatchmakingState,
  MultiplayerGameSummary,
  MultiplayerGamesIndex,
  MultiplayerSnapshot,
  PlayerColor,
  Position,
  SocialOverview,
  SocialPlayerSummary,
  SocialSearchResult,
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

const EMPTY_SOCIAL_OVERVIEW: SocialOverview = {
  friends: [],
  incomingFriendRequests: [],
  outgoingFriendRequests: [],
  incomingInvitations: [],
  outgoingInvitations: [],
};

const INVITATION_DURATION_OPTIONS = [
  { label: "15 min", minutes: 15 },
  { label: "1 hour", minutes: 60 },
  { label: "6 hours", minutes: 360 },
  { label: "24 hours", minutes: 1440 },
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

function isPlayerInSnapshot(
  snapshot: MultiplayerSnapshot | null,
  playerId: string | undefined
) {
  if (!snapshot || !playerId) {
    return false;
  }

  return snapshot.players.some((slot) => slot.player.playerId === playerId);
}

function getOpponentFromSlots(
  players: Array<{ player: SocialPlayerSummary }>,
  playerId: string | undefined
) {
  if (!playerId) {
    return null;
  }

  return players.find((slot) => slot.player.playerId !== playerId)?.player ?? null;
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

function getOpponentLabel(
  summary: MultiplayerGameSummary,
  playerId: string | undefined
) {
  if (!summary.yourSeat) {
    return getOpponentFromSlots(summary.players, playerId)?.displayName || "Waiting for opponent";
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

function formatRelativeExpiry(value: string) {
  const remainingMs = new Date(value).getTime() - Date.now();
  const remainingMinutes = Math.max(0, Math.round(remainingMs / 60000));

  if (remainingMinutes < 60) {
    return `${remainingMinutes}m left`;
  }

  const remainingHours = remainingMinutes / 60;
  if (remainingHours < 24) {
    return `${Math.round(remainingHours)}h left`;
  }

  return `${Math.round(remainingHours / 24)}d left`;
}

function formatPlayerName(
  player: SocialPlayerSummary | { playerId: string; displayName: string },
  currentPlayerId: string | undefined
) {
  return player.playerId === currentPlayerId
    ? `${player.displayName} (you)`
    : player.displayName;
}

function PlayerOverviewAvatar({
  player,
  className,
}: {
  player: {
    displayName?: string;
    profilePicture?: string;
  };
  className?: string;
}) {
  if (player.profilePicture) {
    return (
      <img
        src={player.profilePicture}
        alt={player.displayName ?? "Player"}
        className={cn("h-8 w-8 rounded-full object-cover", className)}
      />
    );
  }

  const initial = (player.displayName || "?").slice(0, 1).toUpperCase();

  return (
    <div
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-full bg-[linear-gradient(180deg,#f4ecde,#e1cda9)] text-xs font-semibold text-[#2e2217]",
        className
      )}
    >
      {initial}
    </div>
  );
}

function EmptySeatAvatar({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "h-8 w-8 rounded-full border border-dashed border-[#cfbb98] bg-[#fbf4e7]",
        className
      )}
      aria-hidden="true"
    />
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={cn("h-4 w-4", className)}
    >
      <path
        d="M7.5 6.25V5a2.5 2.5 0 0 1 2.5-2.5h5a2.5 2.5 0 0 1 2.5 2.5v5A2.5 2.5 0 0 1 15 12.5h-1.25"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x="2.5"
        y="7.5"
        width="10"
        height="10"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={cn("h-4 w-4", className)}
    >
      <path
        d="m4.5 10 3.5 3.5L15.5 6"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function getOptimisticSnapshotStatus(snapshot: MultiplayerSnapshot, state: GameState) {
  if (isGameOver(state)) {
    return "finished";
  }

  if (snapshot.seats.white && snapshot.seats.black) {
    return "active";
  }

  return "waiting";
}

function createOptimisticSnapshot(
  snapshot: MultiplayerSnapshot,
  state: GameState
): MultiplayerSnapshot {
  return {
    ...snapshot,
    state,
    status: getOptimisticSnapshotStatus(snapshot, state),
    updatedAt: new Date().toISOString(),
    rematch: isGameOver(state) ? snapshot.rematch : null,
  };
}

function RoomCodeCopyPill({
  gameId,
  copied,
  onCopy,
}: {
  gameId: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onCopy}
      animate={
        copied
          ? {
              scale: [1, 1.05, 1],
              y: [0, -2, 0],
            }
          : {
              scale: 1,
              y: 0,
            }
      }
      transition={{
        duration: 0.42,
        ease: [0.22, 1, 0.36, 1],
      }}
      className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-[linear-gradient(180deg,#39312b,#16110d)] px-4 py-2 text-sm font-semibold text-[#f9f2e8] shadow-[0_18px_32px_-26px_rgba(0,0,0,0.9)] transition-transform hover:-translate-y-0.5"
      aria-label={`Copy room ID ${gameId}`}
    >
      <span className="font-mono tracking-[0.18em]">{gameId}</span>
      <span
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-full border text-[#f9f2e8]/90 transition-colors",
          copied
            ? "border-[#a7d08e] bg-[#456136] text-[#eef9e8]"
            : "border-white/15 bg-white/8"
        )}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </span>
    </motion.button>
  );
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
  const params = useParams();
  const routeGameId = params.gameId?.trim().toUpperCase() ?? null;

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
  const [copyFeedbackKey, setCopyFeedbackKey] = useState<string | null>(null);
  const [localConfirmReady, setLocalConfirmReady] = useState(true);
  const [multiplayerConfirmReady, setMultiplayerConfirmReady] = useState(true);
  const [computerThinking, setComputerThinking] = useState(false);
  const [matchmaking, setMatchmaking] = useState<MatchmakingState>({
    status: "idle",
  });
  const [matchmakingBusy, setMatchmakingBusy] = useState(false);
  const [socialOverview, setSocialOverview] =
    useState<SocialOverview>(EMPTY_SOCIAL_OVERVIEW);
  const [socialLoading, setSocialLoading] = useState(false);
  const [socialLoaded, setSocialLoaded] = useState(false);
  const [friendSearchQuery, setFriendSearchQuery] = useState("");
  const [friendSearchResults, setFriendSearchResults] = useState<
    SocialSearchResult[]
  >([]);
  const [friendSearchBusy, setFriendSearchBusy] = useState(false);
  const [socialActionBusyKey, setSocialActionBusyKey] = useState<string | null>(
    null
  );
  const [inviteFriendId, setInviteFriendId] = useState("");
  const [inviteDurationMinutes, setInviteDurationMinutes] = useState<number>(
    INVITATION_DURATION_OPTIONS[1].minutes
  );
  const [localScorePulse, setLocalScorePulse] = useState<Record<PlayerColor, number>>(
    { black: 0, white: 0 }
  );
  const [multiplayerScorePulse, setMultiplayerScorePulse] = useState<
    Record<PlayerColor, number>
  >({ black: 0, white: 0 });

  const socketRef = useRef<WebSocket | null>(null);
  const latestAuthRef = useRef<AuthResponse | null>(auth);
  const latestMultiplayerSnapshotRef = useRef<MultiplayerSnapshot | null>(
    multiplayerSnapshot
  );
  const confirmedMultiplayerSnapshotRef = useRef<MultiplayerSnapshot | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const pendingOptimisticUpdateRef = useRef(false);
  const localCardRef = useRef<HTMLDivElement | null>(null);
  const computerCardRef = useRef<HTMLDivElement | null>(null);
  const multiplayerCardRef = useRef<HTMLDivElement | null>(null);
  const localHistoryLengthRef = useRef(localGame.history.length);
  const multiplayerHistoryMetaRef = useRef<{ gameId: string | null; length: number }>({
    gameId: null,
    length: 0,
  });
  const socialInvitationIdsRef = useRef<Set<string>>(new Set());
  const socialInvitationsHydratedRef = useRef(false);

  const localBoardMode = mode === "local" || mode === "computer";
  const computerMode = mode === "computer";
  const accountPlayer = auth?.player.kind === "account";
  const canToastIncomingInvites = mode === "menu" && !routeGameId;
  const websocketDebugEnabled = new URLSearchParams(location.search).has("wsDebug");

  useStonePlacementSound(localBoardMode ? localGame : null);
  useStonePlacementSound(
    mode === "multiplayer" ? multiplayerSnapshot?.state ?? null : null
  );

  useEffect(() => {
    latestAuthRef.current = auth;
  }, [auth]);

  useEffect(() => {
    latestMultiplayerSnapshotRef.current = multiplayerSnapshot;
  }, [multiplayerSnapshot]);

  function clearReconnectTimer() {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }

  function logWebSocketDebug(event: string, details?: Record<string, unknown>) {
    if (!websocketDebugEnabled) {
      return;
    }

    console.info("[tiao ws]", event, details ?? {});
  }

  function commitMultiplayerSnapshot(
    nextSnapshot: MultiplayerSnapshot,
    options: {
      confirmed?: boolean;
    } = {}
  ) {
    if (options.confirmed ?? true) {
      confirmedMultiplayerSnapshotRef.current = nextSnapshot;
      pendingOptimisticUpdateRef.current = false;
    }

    setMultiplayerSnapshot(nextSnapshot);
  }

  function syncMultiplayerSelection(snapshot: MultiplayerSnapshot | null) {
    setMultiplayerSelection(snapshot ? getPendingJumpDestination(snapshot.state) : null);
  }

  function restoreConfirmedSnapshot() {
    const confirmedSnapshot = confirmedMultiplayerSnapshotRef.current;
    pendingOptimisticUpdateRef.current = false;
    if (!confirmedSnapshot) {
      return;
    }

    commitMultiplayerSnapshot(confirmedSnapshot, { confirmed: false });
    syncMultiplayerSelection(confirmedSnapshot);
  }

  function applyMultiplayerGamesIndex(nextGames: MultiplayerGamesIndex) {
    setMultiplayerGames(nextGames);
    setMultiplayerGamesLoaded(true);
  }

  function applySocialOverview(nextOverview: SocialOverview, allowInviteToast: boolean) {
    const incomingIds = new Set(
      nextOverview.incomingInvitations.map((invitation) => invitation.id)
    );

    if (allowInviteToast && socialInvitationsHydratedRef.current && canToastIncomingInvites) {
      for (const invitation of nextOverview.incomingInvitations) {
        if (!socialInvitationIdsRef.current.has(invitation.id)) {
          toast.success(
            `${invitation.sender.displayName} invited you to game ${invitation.gameId}`
          );
        }
      }
    }

    socialInvitationIdsRef.current = incomingIds;
    socialInvitationsHydratedRef.current = true;
    setSocialOverview(nextOverview);
    setSocialLoaded(true);
  }

  async function refreshMultiplayerGames(options: {
    silent?: boolean;
  } = {}) {
    if (!auth || auth.player.kind !== "account") {
      setMultiplayerGames({
        active: [],
        finished: [],
      });
      setMultiplayerGamesLoaded(false);
      setMultiplayerGamesLoading(false);
      return;
    }

    setMultiplayerGamesLoading(true);

    try {
      const response = await listMultiplayerGames();
      applyMultiplayerGamesIndex(response.games);
    } catch (error) {
      if (!options.silent) {
        toastError(error);
      }
    } finally {
      setMultiplayerGamesLoading(false);
    }
  }

  async function refreshSocialOverview(options: {
    silent?: boolean;
    allowInviteToast?: boolean;
  } = {}) {
    if (!auth || auth.player.kind !== "account") {
      setSocialOverview(EMPTY_SOCIAL_OVERVIEW);
      setSocialLoaded(false);
      setSocialLoading(false);
      socialInvitationIdsRef.current.clear();
      socialInvitationsHydratedRef.current = false;
      return;
    }

    setSocialLoading(true);

    try {
      const response = await getSocialOverview();
      applySocialOverview(response.overview, options.allowInviteToast ?? false);
    } catch (error) {
      if (!options.silent) {
        toastError(error);
      }
    } finally {
      setSocialLoading(false);
    }
  }

  useEffect(() => {
    return () => {
      clearReconnectTimer();
      const socket = socketRef.current;
      socketRef.current = null;
      socket?.close();
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
      return;
    }

    void refreshMultiplayerGames({
      silent: true,
    });

    const interval = window.setInterval(() => {
      void refreshMultiplayerGames({
        silent: true,
      });
    }, 25000);

    return () => {
      window.clearInterval(interval);
    };
  }, [auth?.player.kind, auth?.player.playerId]);

  useEffect(() => {
    if (!auth || auth.player.kind !== "account") {
      setSocialOverview(EMPTY_SOCIAL_OVERVIEW);
      setSocialLoaded(false);
      setSocialLoading(false);
      socialInvitationIdsRef.current.clear();
      socialInvitationsHydratedRef.current = false;
      return;
    }

    void refreshSocialOverview({
      silent: true,
      allowInviteToast: false,
    });

    const interval = window.setInterval(() => {
      void refreshSocialOverview({
        silent: true,
        allowInviteToast: true,
      });
    }, 20000);

    return () => {
      window.clearInterval(interval);
    };
  }, [auth?.player.kind, auth?.player.playerId, canToastIncomingInvites]);

  useEffect(() => {
    if (!multiplayerSnapshot) {
      setMultiplayerSelection(null);
      return;
    }

    setMultiplayerSelection(getPendingJumpDestination(multiplayerSnapshot.state));
  }, [multiplayerSnapshot]);

  useEffect(() => {
    if (!inviteFriendId) {
      return;
    }

    const availableFriendIds = new Set(
      socialOverview.friends
        .filter(
          (friend) =>
            !multiplayerSnapshot?.players.some(
              (slot) => slot.player.playerId === friend.playerId
            )
        )
        .map((friend) => friend.playerId)
    );

    if (!availableFriendIds.has(inviteFriendId)) {
      setInviteFriendId("");
    }
  }, [inviteFriendId, multiplayerSnapshot?.players, socialOverview.friends]);

  useEffect(() => {
    if (accountPlayer) {
      return;
    }

    setFriendSearchResults([]);
    setFriendSearchQuery("");
  }, [accountPlayer]);

  useEffect(() => {
    if (!copyFeedback) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      setCopyFeedback(null);
      setCopyFeedbackKey(null);
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
    if (routeGameId) {
      return;
    }

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
  }, [location.search, navigate, routeGameId]);

  useEffect(() => {
    if (!routeGameId || !auth) {
      return;
    }

    if (mode === "multiplayer" && multiplayerSnapshot?.gameId === routeGameId) {
      return;
    }

    void openMultiplayerGame(routeGameId, {
      access: true,
      navigateOnFailure: true,
    });
  }, [
    auth,
    mode,
    multiplayerSnapshot?.gameId,
    routeGameId,
  ]);

  useEffect(() => {
    if (!auth || matchmaking.status !== "searching") {
      return undefined;
    }

    const interval = window.setInterval(() => {
      void (async () => {
        try {
          const response = await getMatchmakingState();
          setMatchmaking(response.matchmaking);

          if (response.matchmaking.status === "matched") {
            connectToRoom(response.matchmaking.snapshot);
            await stopMatchmaking({ silent: true });
          }
        } catch (error) {
          toastError(error);
        }
      })();
    }, 3500);

    return () => {
      window.clearInterval(interval);
    };
  }, [auth, matchmaking.status]);

  const localForcedOrigin = getPendingJumpDestination(localGame);
  const localActiveOrigin = localForcedOrigin ?? localSelection;
  const localJumpTargets = localActiveOrigin
    ? getJumpTargets(localGame, localActiveOrigin, localGame.currentTurn)
    : [];
  const localBoardDisabled =
    computerMode && (computerThinking || localGame.currentTurn === COMPUTER_COLOR);

  const playerSeat = getPlayerSeat(multiplayerSnapshot, auth?.player.playerId);
  const isMultiplayerParticipant = isPlayerInSnapshot(
    multiplayerSnapshot,
    auth?.player.playerId
  );
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
    multiplayerSnapshot?.status === "active" &&
    !!multiplayerSnapshot.seats.white &&
    !!multiplayerSnapshot.seats.black;
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
  const multiplayerSpectating =
    !!multiplayerSnapshot && !isMultiplayerParticipant;
  const multiplayerOpponent = getOpponentFromSlots(
    multiplayerSnapshot?.players ?? [],
    auth?.player.playerId
  );
  const opponentSeat = playerSeat
    ? playerSeat === "white"
      ? "black"
      : "white"
    : null;
  const yourRematchRequestPending =
    !!playerSeat &&
    !!multiplayerSnapshot?.rematch?.requestedBy.includes(playerSeat);
  const incomingRematchRequest =
    !!playerSeat &&
    !!opponentSeat &&
    !!multiplayerSnapshot?.rematch?.requestedBy.includes(opponentSeat);
  const rematchOfferFromOpponent =
    incomingRematchRequest && !yourRematchRequestPending;
  const multiplayerStatusTitle = !multiplayerSnapshot
    ? "Room"
    : multiplayerGameOver
      ? `${multiplayerWinnerLabel} wins`
      : multiplayerWaitingForOpponentSeat
        ? isMultiplayerParticipant
          ? "Waiting for player two"
          : "Spectating lobby"
        : multiplayerYourTurn
          ? "Your move"
          : multiplayerWaitingOnOpponent
            ? "Opponent to move"
            : multiplayerSnapshot && !isMultiplayerParticipant
              ? "Spectating live board"
            : connectionState !== "connected"
              ? "Reconnecting to room"
              : "Live match";
  const inviteableFriends = socialOverview.friends.filter(
    (friend) =>
      !multiplayerSnapshot?.players.some(
        (slot) => slot.player.playerId === friend.playerId
      )
  );
  const currentRoomOutgoingInvitations = socialOverview.outgoingInvitations.filter(
    (invitation) => invitation.gameId === multiplayerSnapshot?.gameId
  );

  useWinConfetti(localBoardMode ? localWinner : null);
  useWinConfetti(mode === "multiplayer" ? multiplayerWinner : null);

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
    clearReconnectTimer();
    const socket = socketRef.current;
    socketRef.current = null;
    socket?.close();
    setConnectionState("idle");
  }

  function clearMultiplayerView() {
    closeMultiplayerConnection();
    setMultiplayerSnapshot(null);
    setMultiplayerSelection(null);
    setMultiplayerError(null);
    setCopyFeedback(null);
    setCopyFeedbackKey(null);
    setMultiplayerScorePulse({ black: 0, white: 0 });
    confirmedMultiplayerSnapshotRef.current = null;
    pendingOptimisticUpdateRef.current = false;
    reconnectAttemptRef.current = 0;
    multiplayerHistoryMetaRef.current = { gameId: null, length: 0 };
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

  async function stopMatchmaking(options: { silent?: boolean } = {}) {
    if (!auth) {
      setMatchmaking({ status: "idle" });
      return;
    }

    try {
      await leaveMatchmaking();
    } catch (error) {
      if (!options.silent) {
        toastError(error);
      }
    } finally {
      setMatchmaking({ status: "idle" });
    }
  }

  function goHome() {
    void stopMatchmaking({ silent: true });
    clearMultiplayerView();
    setComputerThinking(false);
    setMode("menu");
    setNavOpen(false);
    if (location.pathname !== "/") {
      navigate("/");
    }
  }

  function openMenuSection(section: Exclude<MenuTarget, null>) {
    void stopMatchmaking({ silent: true });
    clearMultiplayerView();
    setMode("menu");
    setMenuTarget(section);
    setNavOpen(false);
    if (location.pathname !== "/") {
      navigate("/");
    }
  }

  function enterLocalMode() {
    void stopMatchmaking({ silent: true });
    clearMultiplayerView();
    resetLocalGame();
    setMode("local");
    setNavOpen(false);
    if (location.pathname !== "/") {
      navigate("/");
    }
  }

  function enterComputerMode() {
    void stopMatchmaking({ silent: true });
    clearMultiplayerView();
    resetLocalGame();
    setMode("computer");
    setNavOpen(false);
    if (location.pathname !== "/") {
      navigate("/");
    }
  }

  function openProfilePage() {
    void stopMatchmaking({ silent: true });
    clearMultiplayerView();
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

  function scheduleMultiplayerReconnect() {
    const snapshot = latestMultiplayerSnapshotRef.current;
    const nextAuth = latestAuthRef.current;
    if (!snapshot || !nextAuth) {
      return;
    }

    clearReconnectTimer();
    const delay = Math.min(1500 * Math.max(1, reconnectAttemptRef.current + 1), 7000);
    reconnectAttemptRef.current += 1;
    logWebSocketDebug("schedule-reconnect", {
      delay,
      attempt: reconnectAttemptRef.current,
      gameId: snapshot.gameId,
    });
    reconnectTimerRef.current = window.setTimeout(() => {
      void reconnectToCurrentRoom();
    }, delay);
  }

  function handleUnexpectedMultiplayerDisconnect() {
    logWebSocketDebug("unexpected-disconnect", {
      reconnectAttempt: reconnectAttemptRef.current,
      hasSnapshot: !!latestMultiplayerSnapshotRef.current,
    });
    setConnectionState("disconnected");

    if (pendingOptimisticUpdateRef.current) {
      restoreConfirmedSnapshot();
    }

    if (reconnectAttemptRef.current === 0) {
      toast.error("There was a disconnect from the server. Reconnecting...");
    }

    scheduleMultiplayerReconnect();
  }

  function sendMultiplayerMessage(message: ClientToServerMessage) {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setMultiplayerError("Connection not ready.");
      return;
    }

    const currentSnapshot = latestMultiplayerSnapshotRef.current;
    if (currentSnapshot) {
      let nextState: GameState | null = null;

      switch (message.type) {
        case "place-piece": {
          const result = placePiece(currentSnapshot.state, message.position);
          if (!result.ok) {
            setMultiplayerError(result.reason);
            return;
          }

          nextState = result.value;
          break;
        }
        case "jump-piece": {
          const result = jumpPiece(currentSnapshot.state, message.from, message.to);
          if (!result.ok) {
            setMultiplayerError(result.reason);
            return;
          }

          nextState = result.value;
          break;
        }
        case "confirm-jump": {
          const result = confirmPendingJump(currentSnapshot.state);
          if (!result.ok) {
            setMultiplayerError(result.reason);
            return;
          }

          nextState = result.value;
          break;
        }
        case "undo-pending-jump-step": {
          const result = undoPendingJumpStep(currentSnapshot.state);
          if (!result.ok) {
            setMultiplayerError(result.reason);
            return;
          }

          nextState = result.value;
          break;
        }
        default:
          break;
      }

      if (nextState) {
        pendingOptimisticUpdateRef.current = true;
        const nextSnapshot = createOptimisticSnapshot(currentSnapshot, nextState);
        commitMultiplayerSnapshot(nextSnapshot, { confirmed: false });
        syncMultiplayerSelection(nextSnapshot);
      }
    }

    try {
      socket.send(JSON.stringify(message));
    } catch {
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      socket.close();
      handleUnexpectedMultiplayerDisconnect();
    }
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

  function connectToRoom(
    snapshot: MultiplayerSnapshot,
    options: {
      preserveView?: boolean;
    } = {}
  ) {
    if (options.preserveView) {
      clearReconnectTimer();
      const existingSocket = socketRef.current;
      socketRef.current = null;
      existingSocket?.close();
      setCopyFeedback(null);
      setCopyFeedbackKey(null);
    } else {
      clearMultiplayerView();
    }

    setMode("multiplayer");
    setInviteFriendId("");

    const nextPath = `/game/${snapshot.gameId}`;
    if (location.pathname !== nextPath) {
      navigate(nextPath, { replace: !!routeGameId });
    }

    const socket = new WebSocket(buildWebSocketUrl(snapshot.gameId));
    logWebSocketDebug("connect", {
      url: buildWebSocketUrl(snapshot.gameId),
      preserveView: options.preserveView ?? false,
      gameId: snapshot.gameId,
    });

    socketRef.current = socket;
    setConnectionState("connecting");
    commitMultiplayerSnapshot(snapshot);
    syncMultiplayerSelection(snapshot);

    socket.addEventListener("open", () => {
      if (socketRef.current !== socket) {
        return;
      }

      reconnectAttemptRef.current = 0;
      setConnectionState("connected");
      logWebSocketDebug("open", {
        url: socket.url,
        gameId: snapshot.gameId,
      });
    });

    socket.addEventListener("message", (event) => {
      if (socketRef.current !== socket) {
        return;
      }

      const payload = JSON.parse(event.data as string) as
        | {
            type: "snapshot";
            snapshot: MultiplayerSnapshot;
          }
        | {
            type: "error";
            code?: string;
            message: string;
          };

      if (payload.type === "snapshot") {
        logWebSocketDebug("snapshot", {
          gameId: payload.snapshot.gameId,
          status: payload.snapshot.status,
          historyLength: payload.snapshot.state.history.length,
        });
        commitMultiplayerSnapshot(payload.snapshot);
        syncMultiplayerSelection(payload.snapshot);
        setMultiplayerError(null);
        return;
      }

      logWebSocketDebug("server-error", {
        code: payload.code,
        message: payload.message,
      });

      if (pendingOptimisticUpdateRef.current) {
        restoreConfirmedSnapshot();
      }

      setMultiplayerError(payload.message);
    });

    socket.addEventListener("close", (event) => {
      logWebSocketDebug("close", {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
        readyState: socket.readyState,
      });
      if (socketRef.current !== socket) {
        return;
      }

      socketRef.current = null;
      handleUnexpectedMultiplayerDisconnect();
    });

    socket.addEventListener("error", () => {
      logWebSocketDebug("error", {
        readyState: socket.readyState,
        url: socket.url,
      });
    });
  }

  async function reconnectToCurrentRoom() {
    const snapshot = latestMultiplayerSnapshotRef.current;
    const nextAuth = latestAuthRef.current;
    if (!snapshot || !nextAuth) {
      return;
    }

    setConnectionState("connecting");
    logWebSocketDebug("reconnect-start", {
      gameId: snapshot.gameId,
      attempt: reconnectAttemptRef.current,
    });

    try {
      const response = await accessMultiplayerGame(snapshot.gameId);
      connectToRoom(response.snapshot, {
        preserveView: true,
      });

      if (nextAuth.player.kind === "account") {
        void refreshMultiplayerGames({ silent: true });
        void refreshSocialOverview({ silent: true });
      }
    } catch (error) {
      if (isNetworkError(error)) {
        setConnectionState("disconnected");
        scheduleMultiplayerReconnect();
        return;
      }

      clearMultiplayerView();
      setMode("menu");
      setMultiplayerError(readableError(error));
      if (location.pathname !== "/") {
        navigate("/");
      }
    }
  }

  async function openMultiplayerGame(
    gameId: string,
    options: {
      access?: boolean;
      navigateOnFailure?: boolean;
    } = {}
  ) {
    if (!auth) {
      setMultiplayerError("Player session unavailable.");
      return;
    }

    const normalizedGameId = gameId.trim().toUpperCase();
    setMultiplayerBusy(true);
    setMultiplayerError(null);

    try {
      const response = options.access
        ? await accessMultiplayerGame(normalizedGameId)
        : await getMultiplayerGame(normalizedGameId);

      await stopMatchmaking({ silent: true });
      connectToRoom(response.snapshot);

      if (accountPlayer) {
        void refreshMultiplayerGames({ silent: true });
        void refreshSocialOverview({ silent: true });
      }
    } catch (error) {
      if (isNetworkError(error)) {
        toastError(error);
      } else {
        clearMultiplayerView();
        setMode("menu");
        setMultiplayerError(readableError(error));
        if (options.navigateOnFailure && location.pathname !== "/") {
          navigate("/");
        }
      }
    } finally {
      setMultiplayerBusy(false);
    }
  }

  async function openExistingMultiplayerGame(gameId: string) {
    await openMultiplayerGame(gameId, { access: false });
  }

  async function handleCreateRoom() {
    if (!auth) {
      setMultiplayerError("Player session unavailable.");
      return;
    }

    setMultiplayerBusy(true);
    setMultiplayerError(null);

    try {
      await stopMatchmaking({ silent: true });
      const response = await createMultiplayerGame();
      connectToRoom(response.snapshot);
      if (accountPlayer) {
        void refreshMultiplayerGames({ silent: true });
        void refreshSocialOverview({ silent: true });
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
      await stopMatchmaking({ silent: true });
      const response = await joinMultiplayerGame(joinGameId.trim());
      connectToRoom(response.snapshot);
      if (accountPlayer) {
        void refreshMultiplayerGames({ silent: true });
        void refreshSocialOverview({ silent: true });
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
      setCopyFeedback("Room copied");
      setCopyFeedbackKey("room-id");
    } catch {
      setCopyFeedback("Copy failed");
      setCopyFeedbackKey("room-id");
    }
  }

  function handleMultiplayerUndoPendingJump() {
    sendMultiplayerMessage({ type: "undo-pending-jump-step" });
  }

  function handleRequestRematch() {
    sendMultiplayerMessage({ type: "request-rematch" });
  }

  function handleDeclineRematch() {
    sendMultiplayerMessage({ type: "decline-rematch" });
  }

  async function handleEnterMatchmaking() {
    if (!auth) {
      setMultiplayerError("Player session unavailable.");
      return;
    }

    setMatchmakingBusy(true);

    try {
      clearMultiplayerView();
      const response = await enterMatchmaking();
      setMatchmaking(response.matchmaking);

      if (response.matchmaking.status === "matched") {
        connectToRoom(response.matchmaking.snapshot);
        await stopMatchmaking({ silent: true });
      }
    } catch (error) {
      toastError(error);
    } finally {
      setMatchmakingBusy(false);
    }
  }

  async function handleCancelMatchmaking() {
    setMatchmakingBusy(true);

    try {
      await stopMatchmaking({ silent: false });
    } finally {
      setMatchmakingBusy(false);
    }
  }

  async function runFriendSearch() {
    if (!auth || auth.player.kind !== "account") {
      return;
    }

    if (!friendSearchQuery.trim()) {
      setFriendSearchResults([]);
      return;
    }

    setFriendSearchBusy(true);

    try {
      const response = await searchPlayers(friendSearchQuery.trim());
      setFriendSearchResults(response.results);
    } catch (error) {
      toastError(error);
    } finally {
      setFriendSearchBusy(false);
    }
  }

  async function handleSendFriendRequest(accountId: string) {
    if (!auth || auth.player.kind !== "account") {
      return;
    }

    setSocialActionBusyKey(`friend-send:${accountId}`);

    try {
      await sendFriendRequest(accountId);
      await refreshSocialOverview({ silent: true });
      await runFriendSearch();
    } catch (error) {
      toastError(error);
    } finally {
      setSocialActionBusyKey(null);
    }
  }

  async function handleAcceptFriendRequest(accountId: string) {
    if (!auth || auth.player.kind !== "account") {
      return;
    }

    setSocialActionBusyKey(`friend-accept:${accountId}`);

    try {
      await acceptFriendRequest(accountId);
      await refreshSocialOverview({ silent: true });
      await runFriendSearch();
    } catch (error) {
      toastError(error);
    } finally {
      setSocialActionBusyKey(null);
    }
  }

  async function handleDeclineFriendRequest(accountId: string) {
    if (!auth || auth.player.kind !== "account") {
      return;
    }

    setSocialActionBusyKey(`friend-decline:${accountId}`);

    try {
      await declineFriendRequest(accountId);
      await refreshSocialOverview({ silent: true });
      await runFriendSearch();
    } catch (error) {
      toastError(error);
    } finally {
      setSocialActionBusyKey(null);
    }
  }

  async function handleCancelFriendRequest(accountId: string) {
    if (!auth || auth.player.kind !== "account") {
      return;
    }

    setSocialActionBusyKey(`friend-cancel:${accountId}`);

    try {
      await cancelFriendRequest(accountId);
      await refreshSocialOverview({ silent: true });
      await runFriendSearch();
    } catch (error) {
      toastError(error);
    } finally {
      setSocialActionBusyKey(null);
    }
  }

  async function handleSendGameInvitation() {
    if (
      !auth ||
      auth.player.kind !== "account" ||
      !multiplayerSnapshot ||
      !inviteFriendId
    ) {
      return;
    }

    setSocialActionBusyKey(`invite-send:${inviteFriendId}`);

    try {
      await sendGameInvitation({
        gameId: multiplayerSnapshot.gameId,
        recipientId: inviteFriendId,
        expiresInMinutes: inviteDurationMinutes,
      });
      await refreshSocialOverview({ silent: true });
      setInviteFriendId("");
    } catch (error) {
      toastError(error);
    } finally {
      setSocialActionBusyKey(null);
    }
  }

  async function handleRevokeGameInvitation(invitationId: string) {
    if (!auth || auth.player.kind !== "account") {
      return;
    }

    setSocialActionBusyKey(`invite-revoke:${invitationId}`);

    try {
      await revokeGameInvitation(invitationId);
      await refreshSocialOverview({ silent: true });
    } catch (error) {
      toastError(error);
    } finally {
      setSocialActionBusyKey(null);
    }
  }

  async function handleOpenInvitation(gameId: string) {
    await openMultiplayerGame(gameId, {
      access: true,
    });
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
                    <p className="mt-3 text-sm text-[#6e5b48]">
                      Every room now gets a shareable `/game/ROOMID` link, so the
                      first visitor joins as your opponent and later visitors watch as
                      spectators.
                    </p>
                  </div>

                  <div className="space-y-3 rounded-3xl border border-[#d7c09a] bg-[linear-gradient(180deg,#fffef7,#f6edd9)] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-[#5b4835]">
                          Matchmaking
                        </p>
                        <p className="mt-1 text-sm text-[#6e5b48]">
                          Get paired with the next player who queues up.
                        </p>
                      </div>
                      <Badge className="bg-[#f3e7d5] text-[#6b563e]">
                        {matchmaking.status === "searching"
                          ? "Searching"
                          : matchmaking.status === "matched"
                            ? "Matched"
                            : "Ready"}
                      </Badge>
                    </div>
                    {matchmaking.status === "searching" ? (
                      <div className="rounded-2xl border border-[#dbc59f] bg-[#fff8ee] px-4 py-3 text-sm text-[#6e5b48]">
                        Looking for another player since{" "}
                        <span className="font-semibold text-[#2b1e14]">
                          {formatGameTimestamp(matchmaking.queuedAt)}
                        </span>
                        .
                      </div>
                    ) : null}
                    <div className="grid gap-2">
                      {matchmaking.status === "searching" ? (
                        <Button
                          variant="secondary"
                          className="w-full"
                          onClick={() => void handleCancelMatchmaking()}
                          disabled={matchmakingBusy}
                        >
                          {matchmakingBusy ? "Stopping..." : "Cancel search"}
                        </Button>
                      ) : (
                        <Button
                          size="lg"
                          className="w-full"
                          onClick={() => void handleEnterMatchmaking()}
                          disabled={matchmakingBusy || multiplayerBusy || !auth}
                        >
                          {matchmakingBusy ? "Finding..." : "Find a match"}
                        </Button>
                      )}
                    </div>
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
                                    {getOpponentLabel(game, auth?.player.playerId)}
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
                                    {getOpponentLabel(game, auth?.player.playerId)}
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

            {accountPlayer ? (
              <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
                  <Card className={cn("overflow-hidden", paperCard)}>
                    <div className="h-2 bg-[linear-gradient(90deg,#4f3b24,#b8854e)]" />
                    <CardHeader>
                      <Badge className="w-fit bg-[#f5ead8] text-[#6e5437]">
                        Friends
                      </Badge>
                      <CardTitle className="text-3xl text-[#2b1e14]">
                        Friends and requests
                      </CardTitle>
                      <CardDescription className="text-[#6e5b48]">
                        Search for players, grow your list, and handle incoming requests.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-3 rounded-3xl border border-[#dbc59f] bg-[#fff9ef] p-4">
                        <label className="text-sm font-medium text-[#5b4835]">
                          Find a player
                        </label>
                        <div className="flex flex-col gap-3 sm:flex-row">
                          <Input
                            value={friendSearchQuery}
                            onChange={(event) => setFriendSearchQuery(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void runFriendSearch();
                              }
                            }}
                            placeholder="Search by email or display name"
                          />
                          <Button
                            variant="secondary"
                            onClick={() => void runFriendSearch()}
                            disabled={friendSearchBusy}
                          >
                            {friendSearchBusy ? "Searching..." : "Search"}
                          </Button>
                        </div>
                        {friendSearchResults.length > 0 ? (
                          <div className="space-y-2">
                            {friendSearchResults.map((result) => (
                              <div
                                key={result.player.playerId}
                                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#dcc59f] bg-[#fffdf7] px-4 py-3"
                              >
                                <div>
                                  <p className="font-semibold text-[#2b1e14]">
                                    {result.player.displayName}
                                  </p>
                                  <p className="text-sm text-[#7a6656]">
                                    {result.player.email}
                                  </p>
                                </div>
                                {result.relationship === "none" ? (
                                  <Button
                                    size="sm"
                                    onClick={() =>
                                      void handleSendFriendRequest(result.player.playerId)
                                    }
                                    disabled={
                                      socialActionBusyKey ===
                                      `friend-send:${result.player.playerId}`
                                    }
                                  >
                                    Add friend
                                  </Button>
                                ) : (
                                  <Badge className="bg-[#f3e7d5] text-[#6b563e]">
                                    {result.relationship === "friend"
                                      ? "Already friends"
                                      : result.relationship === "incoming-request"
                                        ? "Incoming request"
                                        : "Request sent"}
                                  </Badge>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : friendSearchQuery.trim() && !friendSearchBusy ? (
                          <p className="text-sm text-[#7a6656]">
                            No players matched that search yet.
                          </p>
                        ) : null}
                      </div>

                      <div className="grid gap-4 lg:grid-cols-2">
                        <div className="rounded-3xl border border-[#dbc59f] bg-[#fff9ef] p-4">
                          <p className="mb-3 text-sm font-medium text-[#5b4835]">
                            Incoming requests
                          </p>
                          <div className="space-y-2">
                            {socialOverview.incomingFriendRequests.length === 0 ? (
                              <p className="text-sm text-[#7a6656]">
                                No pending requests right now.
                              </p>
                            ) : (
                              socialOverview.incomingFriendRequests.map((player) => (
                                <div
                                  key={player.playerId}
                                  className="rounded-2xl border border-[#dcc59f] bg-[#fffdf7] px-4 py-3"
                                >
                                  <p className="font-semibold text-[#2b1e14]">
                                    {player.displayName}
                                  </p>
                                  <div className="mt-3 flex gap-2">
                                    <Button
                                      size="sm"
                                      onClick={() =>
                                        void handleAcceptFriendRequest(player.playerId)
                                      }
                                      disabled={
                                        socialActionBusyKey ===
                                        `friend-accept:${player.playerId}`
                                      }
                                    >
                                      Accept
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() =>
                                        void handleDeclineFriendRequest(player.playerId)
                                      }
                                      disabled={
                                        socialActionBusyKey ===
                                        `friend-decline:${player.playerId}`
                                      }
                                    >
                                      Decline
                                    </Button>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </div>

                        <div className="rounded-3xl border border-[#dbc59f] bg-[#fff9ef] p-4">
                          <p className="mb-3 text-sm font-medium text-[#5b4835]">
                            Outgoing requests
                          </p>
                          <div className="space-y-2">
                            {socialOverview.outgoingFriendRequests.length === 0 ? (
                              <p className="text-sm text-[#7a6656]">
                                No outgoing requests waiting.
                              </p>
                            ) : (
                              socialOverview.outgoingFriendRequests.map((player) => (
                                <div
                                  key={player.playerId}
                                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#dcc59f] bg-[#fffdf7] px-4 py-3"
                                >
                                  <p className="font-semibold text-[#2b1e14]">
                                    {player.displayName}
                                  </p>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() =>
                                      void handleCancelFriendRequest(player.playerId)
                                    }
                                    disabled={
                                      socialActionBusyKey ===
                                      `friend-cancel:${player.playerId}`
                                    }
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="rounded-3xl border border-[#dbc59f] bg-[#fff9ef] p-4">
                        <p className="mb-3 text-sm font-medium text-[#5b4835]">
                          Friends
                        </p>
                        <div className="space-y-2">
                          {!socialLoaded && socialLoading ? (
                            <p className="text-sm text-[#7a6656]">
                              Loading your friends...
                            </p>
                          ) : socialOverview.friends.length === 0 ? (
                            <p className="text-sm text-[#7a6656]">
                              Add a few people and they will show up here for direct invites.
                            </p>
                          ) : (
                            socialOverview.friends.map((player) => (
                              <div
                                key={player.playerId}
                                className="flex items-center justify-between rounded-2xl border border-[#dcc59f] bg-[#fffdf7] px-4 py-3"
                              >
                                <p className="font-semibold text-[#2b1e14]">
                                  {player.displayName}
                                </p>
                                <Badge className="bg-[#efe3cf] text-[#5f4932]">
                                  Friend
                                </Badge>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
                  <Card className={cn("overflow-hidden", paperCard)}>
                    <div className="h-2 bg-[linear-gradient(90deg,#3b3125,#9d7c58)]" />
                    <CardHeader className="gap-3">
                      <Badge className="w-fit bg-[#f2e6d4] text-[#72533a]">
                        Invitations
                      </Badge>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <CardTitle className="text-3xl text-[#2b1e14]">
                            Outstanding invitations
                          </CardTitle>
                          <CardDescription className="text-[#6e5b48]">
                            New incoming invites appear here and toast while you are in the lobby.
                          </CardDescription>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            void refreshSocialOverview({ allowInviteToast: false })
                          }
                          disabled={socialLoading}
                        >
                          {socialLoading ? "Refreshing..." : "Refresh"}
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="rounded-3xl border border-[#dbc59f] bg-[#fff9ef] p-4">
                        <p className="mb-3 text-sm font-medium text-[#5b4835]">
                          Incoming
                        </p>
                        <div className="space-y-2">
                          {socialOverview.incomingInvitations.length === 0 ? (
                            <p className="text-sm text-[#7a6656]">
                              No incoming invitations right now.
                            </p>
                          ) : (
                            socialOverview.incomingInvitations.map((invitation) => (
                              <div
                                key={invitation.id}
                                className="rounded-2xl border border-[#dcc59f] bg-[#fffdf7] px-4 py-3"
                              >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div>
                                    <p className="font-semibold text-[#2b1e14]">
                                      {invitation.sender.displayName}
                                    </p>
                                    <p className="mt-1 text-sm text-[#7a6656]">
                                      Game {invitation.gameId} • {formatRelativeExpiry(invitation.expiresAt)}
                                    </p>
                                  </div>
                                  <Button
                                    size="sm"
                                    onClick={() =>
                                      void handleOpenInvitation(invitation.gameId)
                                    }
                                  >
                                    Open game
                                  </Button>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      <div className="rounded-3xl border border-[#dbc59f] bg-[#fff9ef] p-4">
                        <p className="mb-3 text-sm font-medium text-[#5b4835]">
                          Outgoing
                        </p>
                        <div className="space-y-2">
                          {socialOverview.outgoingInvitations.length === 0 ? (
                            <p className="text-sm text-[#7a6656]">
                              No active invitations sent yet.
                            </p>
                          ) : (
                            socialOverview.outgoingInvitations.map((invitation) => (
                              <div
                                key={invitation.id}
                                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#dcc59f] bg-[#fffdf7] px-4 py-3"
                              >
                                <div>
                                  <p className="font-semibold text-[#2b1e14]">
                                    {invitation.recipient.displayName}
                                  </p>
                                  <p className="mt-1 text-sm text-[#7a6656]">
                                    Game {invitation.gameId} • {formatRelativeExpiry(invitation.expiresAt)}
                                  </p>
                                </div>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() =>
                                    void handleRevokeGameInvitation(invitation.id)
                                  }
                                  disabled={
                                    socialActionBusyKey ===
                                    `invite-revoke:${invitation.id}`
                                  }
                                >
                                  Revoke
                                </Button>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
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

                {multiplayerSnapshot?.status === "waiting" ? (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="flex items-center gap-3 rounded-3xl border border-[#dcc7a2] bg-[#fff7ec]/92 px-5 py-3 text-sm font-semibold text-[#5d4732] shadow-lg backdrop-blur">
                      <HourglassSpinner className="text-[#7b5f3f]" />
                      Waiting for player two. Colors are assigned when they arrive.
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
                  <CardHeader className="gap-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <GamePanelBrand />
                        <Badge className="w-fit bg-[#eee3cf] text-[#5f4932]">
                          Multiplayer
                        </Badge>
                      </div>
                      <div className="flex shrink-0 justify-end">
                        {multiplayerSnapshot && connectionState !== "connected" ? (
                          <motion.div
                            initial={{ opacity: 0, y: -8, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            className="flex items-center gap-2 rounded-full border border-[#d8c29c] bg-[#fff8ee]/96 px-3 py-2 text-sm font-semibold text-[#5d4732] shadow-[0_16px_28px_-22px_rgba(67,45,24,0.5)] backdrop-blur"
                          >
                            <HourglassSpinner className="text-[#7b5f3f]" />
                            {connectionState === "connecting" ? "Connecting" : "Reconnecting"}
                          </motion.div>
                        ) : multiplayerYourTurn ? (
                          <motion.div
                            initial={{ opacity: 0, y: -8, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            className="flex items-center rounded-full border border-[#b8cc8f] bg-[#f7fce9]/96 px-3 py-2 text-sm font-semibold text-[#56703f] shadow-[0_16px_28px_-22px_rgba(63,92,32,0.42)] backdrop-blur"
                          >
                            Your move
                          </motion.div>
                        ) : multiplayerWaitingOnOpponent ? (
                          <motion.div
                            initial={{ opacity: 0, y: -8, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            className="flex items-center gap-2 rounded-full border border-[#d8c29c] bg-[#fff8ee]/96 px-3 py-2 text-sm font-semibold text-[#5d4732] shadow-[0_16px_28px_-22px_rgba(67,45,24,0.5)] backdrop-blur"
                          >
                            <HourglassSpinner className="text-[#7b5f3f]" />
                            Waiting
                          </motion.div>
                        ) : multiplayerWaitingForOpponentSeat ? (
                          <motion.div
                            initial={{ opacity: 0, y: -8, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            className="flex items-center gap-2 rounded-full border border-[#d8c29c] bg-[#fff8ee]/96 px-3 py-2 text-sm font-semibold text-[#5d4732] shadow-[0_16px_28px_-22px_rgba(67,45,24,0.5)] backdrop-blur"
                          >
                            <HourglassSpinner className="text-[#7b5f3f]" />
                            Lobby open
                          </motion.div>
                        ) : multiplayerSpectating ? (
                          <motion.div
                            initial={{ opacity: 0, y: -8, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            className="flex items-center rounded-full border border-[#d8c29c] bg-[#fff8ee]/96 px-3 py-2 text-sm font-semibold text-[#5d4732] shadow-[0_16px_28px_-22px_rgba(67,45,24,0.5)] backdrop-blur"
                          >
                            Spectating
                          </motion.div>
                        ) : null}
                      </div>
                    </div>
                    <CardTitle className="text-[#2b1e14]">Room</CardTitle>
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
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#7b6550]">
                            Room ID
                          </p>
                          <div className="flex flex-wrap items-center gap-3">
                            <RoomCodeCopyPill
                              gameId={multiplayerSnapshot.gameId}
                              copied={
                                copyFeedbackKey === "room-id" &&
                                copyFeedback === "Room copied"
                              }
                              onCopy={() => void handleCopyGameId()}
                            />
                            {copyFeedback ? (
                              <span className="text-sm text-[#7a6656]">
                                {copyFeedback}
                              </span>
                            ) : null}
                          </div>
                        </div>

                        {multiplayerSnapshot.status === "waiting" ? (
                          <div className="space-y-2">
                            {Array.from({ length: 2 }, (_, index) => {
                              const slot = multiplayerSnapshot.players[index] ?? null;
                              return (
                                <div
                                  key={`lobby-player-${index}`}
                                  className="flex items-center justify-between gap-3 rounded-3xl border border-[#d8c29c] bg-[#fffaf1] px-4 py-3"
                                >
                                  <div className="flex items-center gap-3">
                                    {slot ? (
                                      <PlayerOverviewAvatar player={slot.player} />
                                    ) : (
                                      <EmptySeatAvatar />
                                    )}
                                    <div>
                                      <p className="text-sm font-semibold text-[#2b1e14]">
                                        {index === 0 ? "Lobby host" : "Second player"}
                                      </p>
                                      <p className="text-sm text-[#7a6656]">
                                        {slot
                                          ? formatPlayerName(
                                              slot.player,
                                              auth?.player.playerId
                                            )
                                          : "Waiting to join"}
                                      </p>
                                    </div>
                                  </div>
                                  <Badge
                                    className={cn(
                                      slot?.online
                                        ? "bg-[#eef2e8] text-[#43513f]"
                                        : "bg-[#f2e8d9] text-[#6e5b48]"
                                    )}
                                  >
                                    {slot ? (slot.online ? "Online" : "Offline") : "Open"}
                                  </Badge>
                                </div>
                              );
                            })}
                            <p className="rounded-2xl border border-[#dcc59f] bg-[#fff7ea] px-4 py-3 text-sm text-[#6e5b48]">
                              White still starts. The colors are assigned randomly the
                              moment player two joins the lobby.
                            </p>
                          </div>
                        ) : (
                          <div className="grid gap-2">
                            {(["white", "black"] as PlayerColor[]).map((color) => {
                              const seat = multiplayerSnapshot.seats[color];
                              return (
                                <div
                                  key={color}
                                  className="flex items-center justify-between gap-3 rounded-3xl border border-[#d8c29c] bg-[#fffaf1] px-4 py-3"
                                >
                                  <div className="flex items-center gap-3">
                                    {seat ? (
                                      <PlayerOverviewAvatar player={seat.player} />
                                    ) : (
                                      <EmptySeatAvatar />
                                    )}
                                    <div>
                                      <p className="text-sm font-semibold capitalize text-[#2b1e14]">
                                        {color}
                                      </p>
                                      <p className="text-sm text-[#7a6656]">
                                        {seat
                                          ? formatPlayerName(
                                              seat.player,
                                              auth?.player.playerId
                                            )
                                          : "Open"}
                                      </p>
                                    </div>
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
                        )}

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

                        {accountPlayer && isMultiplayerParticipant && !multiplayerGameOver ? (
                          <div className="rounded-3xl border border-[#dcc59f] bg-[#fff9ef] p-4">
                            <p className="mb-3 text-sm font-medium text-[#5b4835]">
                              Invite a friend
                            </p>
                            {inviteableFriends.length === 0 ? (
                              <p className="text-sm text-[#7a6656]">
                                Add friends in the lobby to send direct game invites.
                              </p>
                            ) : (
                              <div className="space-y-3">
                                <select
                                  value={inviteFriendId}
                                  onChange={(event) => setInviteFriendId(event.target.value)}
                                  className="h-10 w-full rounded-xl border border-[#d7c39e] bg-[#fffdf7] px-3 text-sm text-[#2b1e14] outline-none"
                                >
                                  <option value="">Choose a friend</option>
                                  {inviteableFriends.map((friend) => (
                                    <option key={friend.playerId} value={friend.playerId}>
                                      {friend.displayName}
                                    </option>
                                  ))}
                                </select>
                                <select
                                  value={String(inviteDurationMinutes)}
                                  onChange={(event) =>
                                    setInviteDurationMinutes(Number(event.target.value))
                                  }
                                  className="h-10 w-full rounded-xl border border-[#d7c39e] bg-[#fffdf7] px-3 text-sm text-[#2b1e14] outline-none"
                                >
                                  {INVITATION_DURATION_OPTIONS.map((option) => (
                                    <option key={option.minutes} value={option.minutes}>
                                      Keep invite for {option.label}
                                    </option>
                                  ))}
                                </select>
                                <Button
                                  variant="secondary"
                                  className="w-full"
                                  onClick={() => void handleSendGameInvitation()}
                                  disabled={
                                    !inviteFriendId ||
                                    socialActionBusyKey === `invite-send:${inviteFriendId}`
                                  }
                                >
                                  Send invite
                                </Button>
                                {currentRoomOutgoingInvitations.length > 0 ? (
                                  <div className="space-y-2">
                                    {currentRoomOutgoingInvitations.map((invitation) => (
                                      <div
                                        key={invitation.id}
                                        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#dcc59f] bg-[#fffdf7] px-4 py-3"
                                      >
                                        <div>
                                          <p className="font-semibold text-[#2b1e14]">
                                            {invitation.recipient.displayName}
                                          </p>
                                          <p className="text-sm text-[#7a6656]">
                                            {formatRelativeExpiry(invitation.expiresAt)}
                                          </p>
                                        </div>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() =>
                                            void handleRevokeGameInvitation(invitation.id)
                                          }
                                          disabled={
                                            socialActionBusyKey ===
                                            `invite-revoke:${invitation.id}`
                                          }
                                        >
                                          Revoke
                                        </Button>
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            )}
                          </div>
                        ) : null}

                        <div className="grid gap-2">
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
                            {playerSeat ? (
                              <div className="rounded-3xl border border-[#dcc59f] bg-[#fff9ef] p-4 text-sm text-[#6e5b48]">
                                {rematchOfferFromOpponent ? (
                                  <p>
                                    <span className="font-semibold text-[#2b1e14]">
                                      {multiplayerOpponent
                                        ? formatPlayerName(
                                            multiplayerOpponent,
                                            auth?.player.playerId
                                          )
                                        : "Your opponent"}
                                    </span>{" "}
                                    wants a rematch.
                                  </p>
                                ) : yourRematchRequestPending ? (
                                  <p>
                                    Rematch offered. Waiting for{" "}
                                    <span className="font-semibold text-[#2b1e14]">
                                      {multiplayerOpponent
                                        ? formatPlayerName(
                                            multiplayerOpponent,
                                            auth?.player.playerId
                                          )
                                        : "your opponent"}
                                    </span>
                                    .
                                  </p>
                                ) : (
                                  <p>
                                    Want another round? Rematches reshuffle colors before
                                    white opens again.
                                  </p>
                                )}
                              </div>
                            ) : null}
                            {playerSeat ? (
                              rematchOfferFromOpponent ? (
                                <div className="grid gap-2 sm:grid-cols-2">
                                  <Button
                                    variant="secondary"
                                    onClick={handleRequestRematch}
                                    disabled={connectionState !== "connected"}
                                  >
                                    Accept rematch
                                  </Button>
                                  <Button
                                    variant="outline"
                                    onClick={handleDeclineRematch}
                                    disabled={connectionState !== "connected"}
                                  >
                                    Decline
                                  </Button>
                                </div>
                              ) : (
                                <Button
                                  variant="secondary"
                                  onClick={handleRequestRematch}
                                  disabled={
                                    connectionState !== "connected" ||
                                    yourRematchRequestPending
                                  }
                                >
                                  {yourRematchRequestPending
                                    ? "Rematch requested"
                                    : "Offer rematch"}
                                </Button>
                              )
                            ) : null}
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
