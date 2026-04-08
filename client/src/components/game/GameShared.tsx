import { useEffect, useState } from "react";
import { motion, useAnimationControls } from "framer-motion";
import { GameState, PlayerColor, isGameOver } from "@shared";
import type {
  MultiplayerSnapshot,
  MultiplayerGameSummary,
  SocialPlayerSummary,
  FinishReason,
} from "@shared";
import { cn } from "@/lib/utils";
import { PlayerIdentityRow } from "@/components/PlayerIdentityRow";
import { formatClockTime } from "./GameClock";

/** Loose translation function type compatible with next-intl's Translator. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TranslateFn = (key: string, values?: Record<string, any>) => string;

// --- Color Dot ---

export function ColorDot({ color, className }: { color: PlayerColor; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-4 w-4 shrink-0 rounded-full border",
        color === "white"
          ? "border-[#ddd2bf] bg-[radial-gradient(circle_at_30%_28%,#fffdfa,#f4eee3_58%,#d9ccb8)]"
          : "border-[#191410] bg-[radial-gradient(circle_at_30%_28%,#5d554f,#2d2622_58%,#0f0c0b)]",
        className,
      )}
    />
  );
}

// --- Icons ---

/**
 * Bullseye icon used to label score values ("race to N"). Stroke-only so the
 * two outer rings read clearly at the 12px size used in game cards.
 */
export function ScoreTargetIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
      className={cn("h-3 w-3", className)}
    >
      <circle cx="8" cy="8" r="6.5" strokeWidth="1.25" />
      <circle cx="8" cy="8" r="3.5" strokeWidth="1.25" />
      <circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function CopyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={cn("h-4 w-4", className)}>
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

export function LinkIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={cn("h-4 w-4", className)}>
      <path
        d="M11.875 7.625a3.125 3.125 0 0 1 0 4.417l-1.875 1.875a3.125 3.125 0 0 1-4.417-4.417l.625-.625m3.75 3.125a3.125 3.125 0 0 1 0-4.417l1.875-1.875a3.125 3.125 0 0 1 4.417 4.417l-.625.625"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function EyeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={cn("h-4 w-4", className)}>
      <path
        d="M1.719 10.29a.833.833 0 0 1 0-.58 8.958 8.958 0 0 1 16.563 0 .833.833 0 0 1 0 .58 8.958 8.958 0 0 1-16.563 0Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={cn("h-4 w-4", className)}>
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

// --- Helpers ---

export function getOpponentFromSlots(
  players: Array<{ player: SocialPlayerSummary }>,
  playerId: string | undefined,
) {
  if (!playerId) {
    return null;
  }

  return players.find((slot) => slot.player.playerId !== playerId)?.player ?? null;
}

export function formatPlayerColor(color: PlayerColor | null) {
  if (!color) {
    return null;
  }

  return color.slice(0, 1).toUpperCase() + color.slice(1);
}

/**
 * Return a translated color name (e.g. "Weiß" in German, "Blancas" in Spanish).
 * Use this instead of `formatPlayerColor` whenever the result is interpolated into
 * a translated string so that color names are properly localised.
 *
 * `t` must be scoped to the "game" namespace (i.e. `useTranslations("game")`).
 */
export function translatePlayerColor(
  color: PlayerColor | null,
  t: (key: string) => string,
): string | null {
  if (!color) {
    return null;
  }

  return t(color); // resolves "game.white" / "game.black"
}

export function formatGameTimestamp(value: string, locale?: string) {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function isSummaryYourTurn(summary: MultiplayerGameSummary) {
  return (
    summary.status === "active" && !!summary.yourSeat && summary.currentTurn === summary.yourSeat
  );
}

export function getOpponentLabel(
  summary: MultiplayerGameSummary,
  playerId: string | undefined,
  t?: (key: string) => string,
) {
  if (!summary.yourSeat) {
    return (
      getOpponentFromSlots(summary.players, playerId)?.displayName ||
      (t ? t("waitingForOpponent") : "Waiting for opponent")
    );
  }

  const opponentColor = summary.yourSeat === "white" ? "black" : "white";
  return summary.seats[opponentColor]?.player.displayName || (t ? t("openSeat") : "Open seat");
}

export function getSummaryStatusLabel(summary: MultiplayerGameSummary, t?: TranslateFn) {
  if (summary.status === "finished") {
    const color = t
      ? (translatePlayerColor(summary.winner, t) ?? "")
      : formatPlayerColor(summary.winner);
    return t ? t("colorWon", { color }) : `${color} won`;
  }

  if (summary.status === "waiting") {
    return t ? t("waiting") : "Waiting";
  }

  if (isSummaryYourTurn(summary)) {
    return t ? t("yourTurn") : "Your turn";
  }
  return t ? t("opponentsTurn") : "Opponent's turn";
}

export function formatRelativeExpiry(value: string, t?: TranslateFn) {
  const remainingMs = new Date(value).getTime() - Date.now();
  const remainingMinutes = Math.max(0, Math.round(remainingMs / 60000));

  if (remainingMinutes < 60) {
    return t ? t("mLeft", { n: remainingMinutes }) : `${remainingMinutes}m left`;
  }

  const remainingHours = remainingMinutes / 60;
  if (remainingHours < 24) {
    const h = Math.round(remainingHours);
    return t ? t("hLeft", { n: h }) : `${h}h left`;
  }

  const d = Math.round(remainingHours / 24);
  return t ? t("dLeft", { n: d }) : `${d}d left`;
}

export function formatPlayerName(
  player: SocialPlayerSummary | { playerId: string; displayName: string },
  currentPlayerId: string | undefined,
  youLabel?: string,
) {
  return player.playerId === currentPlayerId
    ? `${player.displayName} ${youLabel ?? "(you)"}`
    : player.displayName;
}

export function getOptimisticSnapshotStatus(snapshot: MultiplayerSnapshot, state: GameState) {
  if (isGameOver(state)) {
    return "finished";
  }

  if (snapshot.seats.white && snapshot.seats.black) {
    return "active";
  }

  return "waiting";
}

export function createOptimisticSnapshot(
  snapshot: MultiplayerSnapshot,
  state: GameState,
): MultiplayerSnapshot {
  return {
    ...snapshot,
    state,
    status: getOptimisticSnapshotStatus(snapshot, state),
    updatedAt: new Date().toISOString(),
    rematch: isGameOver(state) ? snapshot.rematch : null,
    takeback: snapshot.takeback,
  };
}

export function formatFinishReason(
  reason: FinishReason | null,
  scoreToWin?: number,
  t?: TranslateFn,
): string {
  switch (reason) {
    case "captured":
      return t
        ? t("scoreReached", { score: scoreToWin ?? "" })
        : `Score reached${scoreToWin ? ` (${scoreToWin})` : ""}`;
    case "forfeit":
      return t ? t("forfeit") : "Forfeit";
    case "timeout":
      return t ? t("timeRanOut") : "Time ran out";
    case "board_full":
      return t ? t("boardFull") : "Board full";
    default:
      return "";
  }
}

/** Describe a game result for match history — context-aware messages.
 *  When `playerName` is provided, uses third-person "{name} forfeited" style
 *  instead of "You forfeited" (for viewing another player's profile). */
export function describeResult(
  result: "won" | "lost" | null,
  finishReason: FinishReason | null,
  t?: (key: string, values?: Record<string, string>) => string,
  playerName?: string,
): string {
  if (!result) return "";
  if (result === "won") {
    switch (finishReason) {
      case "captured":
        return t
          ? playerName
            ? t("playerReachedTarget", { name: playerName })
            : t("scoreTargetReached")
          : "Score target reached";
      case "forfeit":
        return t ? t("opponentForfeited") : "Opponent forfeited";
      case "timeout":
        return t ? t("opponentTimedOut") : "Opponent ran out of time";
      case "board_full":
        return t
          ? playerName
            ? t("boardFullPlayerWon", { name: playerName })
            : t("boardFullYouWon")
          : "Board full — you had more points";
      default:
        return "";
    }
  }
  switch (finishReason) {
    case "captured":
      return t
        ? playerName
          ? t("opponentReachedTargetPlayer")
          : t("opponentReachedTarget")
        : "Opponent reached score target";
    case "forfeit":
      return t
        ? playerName
          ? t("playerForfeited", { name: playerName })
          : t("youForfeited")
        : "You forfeited";
    case "timeout":
      return t
        ? playerName
          ? t("playerTimedOut", { name: playerName })
          : t("youTimedOut")
        : "You ran out of time";
    case "board_full":
      return t
        ? playerName
          ? t("boardFullPlayerLost", { name: playerName })
          : t("boardFullOpponentWon")
        : "Board full — opponent had more points";
    default:
      return "";
  }
}

export function getPlayerResult(summary: MultiplayerGameSummary): "won" | "lost" | null {
  if (summary.status !== "finished" || !summary.winner || !summary.yourSeat) {
    return null;
  }
  return summary.winner === summary.yourSeat ? "won" : "lost";
}

// --- Components ---

export function ConnectionDot({ online, className }: { online: boolean; className?: string }) {
  return (
    <span
      role="status"
      aria-label={online ? "Player is online" : "Player is offline"}
      className={cn(
        "inline-block h-2.5 w-2.5 shrink-0 rounded-full",
        online ? "bg-emerald-500" : "bg-stone-300",
        className,
      )}
    />
  );
}

export function PlayerOverviewAvatar({
  player,
  className,
  anonymous,
}: {
  player: {
    displayName?: string;
    profilePicture?: string;
  };
  className?: string;
  anonymous?: boolean;
}) {
  const [imgError, setImgError] = useState(false);

  if (player.profilePicture && !imgError) {
    return (
      <img
        src={player.profilePicture}
        alt={player.displayName ?? "Player"}
        className={cn("h-8 w-8 rounded-full object-cover", className)}
        onError={() => setImgError(true)}
      />
    );
  }

  if (anonymous) {
    return (
      <div
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-full border border-[#a37d48]/35 bg-[linear-gradient(180deg,#fbf2dd,#edd7ac)] text-[#594125]",
          className,
        )}
      >
        <span className="relative block h-[75%] w-[75%]">
          <span className="absolute left-1/2 top-[2px] h-2.5 w-2.5 -translate-x-1/2 rounded-full border border-current" />
          <span className="absolute bottom-[2px] left-1/2 h-3.5 w-5 -translate-x-1/2 rounded-t-full border border-current border-b-0" />
        </span>
      </div>
    );
  }

  const initial = (player.displayName || "?").slice(0, 1).toUpperCase();

  return (
    <div
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-full bg-[linear-gradient(180deg,#f4ecde,#e1cda9)] text-xs font-semibold text-[#2e2217]",
        className,
      )}
    >
      {initial}
    </div>
  );
}

export function EmptySeatAvatar({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "h-8 w-8 rounded-full border border-dashed border-[#cfbb98] bg-[#fbf4e7]",
        className,
      )}
      aria-hidden="true"
    />
  );
}

/** Inner icon circle used by all dark-pill buttons. Shows a checkmark when `copied` is true. */
export function DarkPillIconCircle({ copied, icon }: { copied: boolean; icon: React.ReactNode }) {
  return (
    <span
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded-full border text-[#f9f2e8]/90 transition-colors",
        copied ? "border-[#a7d08e] bg-[#456136] text-[#eef9e8]" : "border-white/15 bg-white/8",
      )}
    >
      {copied ? <CheckIcon /> : icon}
    </span>
  );
}

/** Dark pill button with bounce animation on success. Used for copy actions in the game header. */
export function DarkPillButton({
  copied,
  onClick,
  icon,
  ariaLabel,
  title,
  className: extraClassName,
  hideIcon,
  children,
}: {
  copied: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  ariaLabel?: string;
  title?: string;
  className?: string;
  hideIcon?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      animate={copied ? { scale: [1, 1.05, 1], y: [0, -2, 0] } : { scale: 1, y: 0 }}
      transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "inline-flex items-center justify-center rounded-full border border-black/10 bg-[linear-gradient(180deg,#39312b,#16110d)] text-[#f9f2e8] shadow-[0_18px_32px_-26px_rgba(0,0,0,0.9)] transition-transform hover:-translate-y-0.5",
        extraClassName,
      )}
      aria-label={ariaLabel}
      title={title}
    >
      {children}
      {!hideIcon && <DarkPillIconCircle copied={copied} icon={icon} />}
    </motion.button>
  );
}

export function RoomCodeCopyPill({
  gameId,
  copied,
  onCopy,
  hideCopyIcon,
}: {
  gameId: string;
  copied: boolean;
  onCopy: () => void;
  hideCopyIcon?: boolean;
}) {
  return (
    <DarkPillButton
      copied={copied}
      onClick={onCopy}
      icon={<CopyIcon />}
      ariaLabel={`Copy game ID ${gameId}`}
      className="gap-2 px-4 py-2 text-sm font-semibold"
      hideIcon={hideCopyIcon}
    >
      <span className="font-mono tracking-[0.18em]">{gameId}</span>
    </DarkPillButton>
  );
}

export function ShareLinkCopyPill({ copied, onCopy }: { copied: boolean; onCopy: () => void }) {
  return (
    <DarkPillButton
      copied={copied}
      onClick={onCopy}
      icon={<LinkIcon />}
      ariaLabel="Copy share link"
      className="h-10 w-10"
    />
  );
}

export function SpectateButton({
  copied,
  spectatorCount,
  onCopy,
  onShowSpectators,
}: {
  copied: boolean;
  spectatorCount: number;
  onCopy: () => void;
  onShowSpectators: () => void;
}) {
  const label =
    spectatorCount > 0
      ? `${spectatorCount} spectator${spectatorCount !== 1 ? "s" : ""}`
      : "Copy spectate link";
  return (
    <DarkPillButton
      copied={copied}
      onClick={spectatorCount > 0 ? onShowSpectators : onCopy}
      icon={<EyeIcon />}
      ariaLabel={label}
      title={label}
      className={cn(
        "mr-1 h-10",
        spectatorCount > 0 ? "gap-1.5 px-3.5 text-xs font-semibold" : "w-10",
      )}
    >
      {spectatorCount > 0 && <span className="order-1">{spectatorCount}</span>}
    </DarkPillButton>
  );
}

export function HourglassSpinner({ className }: { className?: string }) {
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

export function GamePanelBrand() {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#f6e8cf]/55 bg-[linear-gradient(180deg,#faefd8,#ecd4a6)] font-display text-2xl text-[#25170d] shadow-[0_14px_28px_-18px_rgba(37,23,13,0.85)]">
        跳
      </span>
      <span className="font-display text-3xl tracking-tight text-[#2f2015]">Tiao</span>
    </div>
  );
}

export type AnimatedScoreTilePlayerInfo = {
  player: { displayName?: string; profilePicture?: string; playerId: string };
  online: boolean;
  isYou?: boolean;
  isFriend?: boolean;
  hasPendingOutgoing?: boolean;
  canBefriend?: boolean | null;
  onAddFriend?: () => void;
  addFriendBusy?: boolean;
  onCancelFriendRequest?: () => void;
  cancelFriendRequestBusy?: boolean;
  variant?: "dark" | "light";
};

type AnimatedScoreTileProps = {
  label: string;
  value: number;
  pulseKey: number;
  className: string;
  labelClassName: string;
  valueClassName?: string;
  playerInfo?: AnimatedScoreTilePlayerInfo;
  /** Remaining clock time in ms. When provided, shows a formatted clock next to the score. */
  clockMs?: number | null;
  /** Whether this player's clock is currently ticking. */
  clockActive?: boolean;
  /** Target score to win. When non-default, shown as "X / Y". */
  scoreToWin?: number;
};

export function AnimatedScoreTile({
  label,
  value,
  pulseKey,
  className,
  labelClassName,
  valueClassName = "mt-2 text-3xl font-semibold tabular-nums",
  playerInfo,
  clockMs,
  clockActive,
  scoreToWin,
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
      className={cn("relative", className)}
      style={{ transformOrigin: "center bottom" }}
    >
      {playerInfo && (
        <>
          <div className="absolute right-3 top-3">
            <ConnectionDot online={playerInfo.online} />
          </div>
          <PlayerIdentityRow
            player={playerInfo.player}
            currentPlayerId={playerInfo.isYou ? playerInfo.player.playerId : undefined}
            avatarClassName="h-6 w-6"
            showFriendBadge={playerInfo.isFriend}
            showPending={playerInfo.hasPendingOutgoing}
            onCancelPending={playerInfo.onCancelFriendRequest}
            cancelPendingBusy={playerInfo.cancelFriendRequestBusy}
            showAddFriend={!!playerInfo.canBefriend}
            onAddFriend={playerInfo.onAddFriend}
            addFriendBusy={playerInfo.addFriendBusy}
            friendVariant={playerInfo.variant}
            className="mb-2 pr-6"
            nameClassName="text-xs font-semibold opacity-80"
          />
        </>
      )}
      <p className={labelClassName}>{label}</p>
      <div className="flex items-baseline justify-between gap-2">
        <motion.p initial={{ scale: 1, y: 0 }} animate={valueControls} className={valueClassName}>
          {value}
          {scoreToWin != null && (
            <span className="text-base font-normal opacity-50"> / {scoreToWin}</span>
          )}
        </motion.p>
        {clockMs != null && (
          <span
            className={cn(
              "font-mono text-xl tabular-nums opacity-70",
              clockActive && "opacity-100",
              clockMs < 10_000 && clockMs > 0 && "text-red-400 font-bold opacity-100",
              clockMs < 30_000 && clockMs >= 10_000 && "text-amber-400 font-semibold opacity-100",
              clockMs <= 0 && "text-red-400 font-bold opacity-100",
            )}
          >
            {formatClockTime(clockMs)}
          </span>
        )}
      </div>
    </motion.div>
  );
}
