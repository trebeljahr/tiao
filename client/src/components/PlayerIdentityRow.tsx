import React from "react";
import { cn } from "@/lib/utils";
import { PlayerOverviewAvatar, ConnectionDot } from "@/components/game/GameShared";

type PlayerIdentityRowProps = {
  player: { playerId?: string; displayName?: string; profilePicture?: string };
  anonymous?: boolean;
  currentPlayerId?: string;
  avatarClassName?: string;
  online?: boolean | null;
  showFriendBadge?: boolean;
  showAddFriend?: boolean;
  onAddFriend?: () => void;
  addFriendBusy?: boolean;
  showPending?: boolean;
  onCancelPending?: () => void;
  cancelPendingBusy?: boolean;
  friendVariant?: "dark" | "light";
  className?: string;
  nameClassName?: string;
  children?: React.ReactNode;
};

export function PlayerIdentityRow({
  player,
  anonymous,
  currentPlayerId,
  avatarClassName,
  online,
  showFriendBadge,
  showAddFriend,
  onAddFriend,
  addFriendBusy,
  showPending,
  onCancelPending,
  cancelPendingBusy,
  friendVariant,
  className,
  nameClassName,
  children,
}: PlayerIdentityRowProps) {
  const isYou = currentPlayerId != null && player.playerId === currentPlayerId;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <PlayerOverviewAvatar
        player={player}
        anonymous={anonymous}
        className={avatarClassName}
      />
      <span className={cn("truncate text-sm font-medium", nameClassName)}>
        {player.displayName ?? "Player"}
        {isYou && <span className="opacity-60"> (you)</span>}
      </span>

      {online != null && (
        <ConnectionDot online={online} />
      )}

      {showFriendBadge && (
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            friendVariant === "light"
              ? "bg-black/10 text-black/60"
              : "bg-white/20",
          )}
        >
          Friend
        </span>
      )}

      {showPending && (
        <button
          type="button"
          title="Cancel friend request"
          className={cn(
            "group flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors",
            friendVariant === "light"
              ? "bg-black/10 text-black/50 hover:bg-red-100 hover:text-red-600"
              : "bg-white/20 opacity-70 hover:bg-red-500/30 hover:text-red-200 hover:opacity-100",
          )}
          onClick={onCancelPending}
          disabled={cancelPendingBusy}
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

      {showAddFriend && onAddFriend && (
        <button
          type="button"
          title={`Send friend request to ${player.displayName}`}
          className="flex shrink-0 items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[0.65rem] font-semibold transition-colors hover:bg-white/35 disabled:opacity-50"
          onClick={onAddFriend}
          disabled={addFriendBusy}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-3.5 w-3.5"
          >
            <path d="M11 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM2.046 15.253c-.058.468.172.92.57 1.175A9.953 9.953 0 0 0 8 18c1.982 0 3.83-.578 5.384-1.573.398-.254.628-.707.57-1.175a6.001 6.001 0 0 0-11.908 0ZM15.75 6.5a.75.75 0 0 0-1.5 0v2h-2a.75.75 0 0 0 0 1.5h2v2a.75.75 0 0 0 1.5 0v-2h2a.75.75 0 0 0 0-1.5h-2v-2Z" />
          </svg>
          Add friend
        </button>
      )}

      {children}
    </div>
  );
}
