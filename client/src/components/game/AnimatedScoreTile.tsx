"use client";

import { useEffect } from "react";
import { motion, useAnimationControls } from "framer-motion";
import { cn } from "@/lib/utils";
import { ConnectionDot } from "./GameShared";
import { formatClockTime } from "./GameClock";
import { PlayerIdentityRow } from "@/components/PlayerIdentityRow";

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
  /** Extra content rendered inside PlayerIdentityRow (e.g. report button). */
  playerChildren?: React.ReactNode;
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
  playerChildren,
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
          >
            {playerChildren}
          </PlayerIdentityRow>
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
