import React, { useEffect } from "react";
import { motion, useAnimationControls } from "framer-motion";
import {
  BOARD_SIZE,
  GameState,
  PlayerColor,
  Position,
  isGameOver,
  getPendingJumpDestination,
} from "@shared";
import type {
  MultiplayerSnapshot,
  MultiplayerGameSummary,
  SocialPlayerSummary,
} from "@shared";
import { cn } from "@/lib/utils";

// --- Icons ---

export function CopyIcon({ className }: { className?: string }) {
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

export function LinkIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={cn("h-4 w-4", className)}
    >
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

export function CheckIcon({ className }: { className?: string }) {
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

// --- Helpers ---

export function getOpponentFromSlots(
  players: Array<{ player: SocialPlayerSummary }>,
  playerId: string | undefined,
) {
  if (!playerId) {
    return null;
  }

  return (
    players.find((slot) => slot.player.playerId !== playerId)?.player ?? null
  );
}

export function formatPlayerColor(color: PlayerColor | null) {
  if (!color) {
    return null;
  }

  return color.slice(0, 1).toUpperCase() + color.slice(1);
}

export function formatGameTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function isSummaryYourTurn(summary: MultiplayerGameSummary) {
  return (
    summary.status === "active" &&
    !!summary.yourSeat &&
    summary.currentTurn === summary.yourSeat
  );
}

export function getOpponentLabel(
  summary: MultiplayerGameSummary,
  playerId: string | undefined,
) {
  if (!summary.yourSeat) {
    return (
      getOpponentFromSlots(summary.players, playerId)?.displayName ||
      "Waiting for opponent"
    );
  }

  const opponentColor = summary.yourSeat === "white" ? "black" : "white";
  return summary.seats[opponentColor]?.player.displayName || "Open seat";
}

export function getSummaryStatusLabel(summary: MultiplayerGameSummary) {
  if (summary.status === "finished") {
    return `${formatPlayerColor(summary.winner)} won`;
  }

  if (summary.status === "waiting") {
    return "Waiting for player two";
  }

  return isSummaryYourTurn(summary) ? "Your move" : "Waiting for opponent";
}

export function formatRelativeExpiry(value: string) {
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

export function formatPlayerName(
  player: SocialPlayerSummary | { playerId: string; displayName: string },
  currentPlayerId: string | undefined,
) {
  return player.playerId === currentPlayerId
    ? `${player.displayName} (you)`
    : player.displayName;
}

export function getOptimisticSnapshotStatus(
  snapshot: MultiplayerSnapshot,
  state: GameState,
) {
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

// --- Components ---

export function ConnectionDot({
  online,
  className,
}: {
  online: boolean;
  className?: string;
}) {
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

export function RoomCodeCopyPill({
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
      aria-label={`Copy game ID ${gameId}`}
    >
      <span className="font-mono tracking-[0.18em]">{gameId}</span>
      <span
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-full border text-[#f9f2e8]/90 transition-colors",
          copied
            ? "border-[#a7d08e] bg-[#456136] text-[#eef9e8]"
            : "border-white/15 bg-white/8",
        )}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </span>
    </motion.button>
  );
}

export function ShareLinkCopyPill({
  copied,
  onCopy,
}: {
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
      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-[linear-gradient(180deg,#39312b,#16110d)] text-[#f9f2e8] shadow-[0_18px_32px_-26px_rgba(0,0,0,0.9)] transition-transform hover:-translate-y-0.5"
      aria-label="Copy share link"
    >
      <span
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-full border text-[#f9f2e8]/90 transition-colors",
          copied
            ? "border-[#a7d08e] bg-[#456136] text-[#eef9e8]"
            : "border-white/15 bg-white/8",
        )}
      >
        {copied ? <CheckIcon /> : <LinkIcon />}
      </span>
    </motion.button>
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
      <span className="font-display text-3xl tracking-tight text-[#2f2015]">
        Tiao
      </span>
    </div>
  );
}

type AnimatedScoreTilePlayerInfo = {
  player: { displayName?: string; profilePicture?: string; playerId: string };
  online: boolean;
  isYou?: boolean;
  isFriend?: boolean;
  hasPendingOutgoing?: boolean;
  canBefriend?: boolean;
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
};

export function AnimatedScoreTile({
  label,
  value,
  pulseKey,
  className,
  labelClassName,
  valueClassName = "mt-2 text-3xl font-semibold tabular-nums",
  playerInfo,
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
          <div className="mb-2 flex items-center gap-2 pr-6">
            <PlayerOverviewAvatar
              player={playerInfo.player}
              className="h-6 w-6"
            />
            <span className="truncate text-xs font-semibold opacity-80">
              {playerInfo.player.displayName ?? "Player"}
              {playerInfo.isYou && (
                <span className="opacity-60"> (you)</span>
              )}
            </span>
            {playerInfo.isFriend && (
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  playerInfo.variant === "light"
                    ? "bg-black/10 text-black/60"
                    : "bg-white/20",
                )}
              >
                Friend
              </span>
            )}
            {playerInfo.hasPendingOutgoing && (
              <button
                type="button"
                title="Cancel friend request"
                className={cn(
                  "group flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors",
                  playerInfo.variant === "light"
                    ? "bg-black/10 text-black/50 hover:bg-red-100 hover:text-red-600"
                    : "bg-white/20 opacity-70 hover:bg-red-500/30 hover:text-red-200 hover:opacity-100",
                )}
                onClick={playerInfo.onCancelFriendRequest}
                disabled={playerInfo.cancelFriendRequestBusy}
              >
                Pending
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  className="h-2.5 w-2.5 opacity-50 group-hover:opacity-100"
                >
                  <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
                </svg>
              </button>
            )}
            {playerInfo.canBefriend && playerInfo.onAddFriend && (
              <button
                type="button"
                title={`Send friend request to ${playerInfo.player.displayName}`}
                className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/20 transition-colors hover:bg-white/35"
                onClick={playerInfo.onAddFriend}
                disabled={playerInfo.addFriendBusy}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-3 w-3"
                >
                  <path d="M11 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM2.046 15.253c-.058.468.172.92.57 1.175A9.953 9.953 0 0 0 8 18c1.982 0 3.83-.578 5.384-1.573.398-.254.628-.707.57-1.175a6.001 6.001 0 0 0-11.908 0ZM15.75 6.5a.75.75 0 0 0-1.5 0v2h-2a.75.75 0 0 0 0 1.5h2v2a.75.75 0 0 0 1.5 0v-2h2a.75.75 0 0 0 0-1.5h-2v-2Z" />
                </svg>
              </button>
            )}
          </div>
        </>
      )}
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
