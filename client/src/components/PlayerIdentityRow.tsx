import React from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { PlayerOverviewAvatar, ConnectionDot } from "@/components/game/GameShared";
import { UserBadge, type BadgeId } from "@/components/UserBadge";
import { resolvePlayerBadges, isDevFeatureEnabled } from "@/lib/featureGate";
import { Link } from "@/i18n/navigation";

export const DELETED_PLAYER_NAME = "Deleted Player";

function InfoTooltip({
  text,
  className,
  iconClassName,
}: {
  text: string;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <span className={cn("group/tip relative inline-flex items-center justify-center", className)}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className={cn("h-3.5 w-3.5", iconClassName)}
      >
        <path
          fillRule="evenodd"
          d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z"
          clipRule="evenodd"
        />
      </svg>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 hidden w-max max-w-48 -translate-x-1/2 rounded-md bg-[#1a1008] px-2.5 py-1.5 text-xs text-white shadow-lg group-hover/tip:block">
        {text}
      </span>
    </span>
  );
}

export function isDeletedPlayer(player: { displayName?: string }): boolean {
  return player.displayName === DELETED_PLAYER_NAME;
}

type PlayerIdentityRowProps = {
  player: {
    playerId?: string;
    displayName?: string;
    profilePicture?: string;
    activeBadges?: string[];
    rating?: number;
  };
  anonymous?: boolean;
  currentPlayerId?: string;
  avatarClassName?: string;
  online?: boolean | null;
  /** Wrap the avatar, name, and badges in a link to the player's public profile (default: true). */
  linkToProfile?: boolean;
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
  linkToProfile = true,
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
  const t = useTranslations("common");
  const isYou = currentPlayerId != null && player.playerId === currentPlayerId;
  const badgesToShow = resolvePlayerBadges(player);
  const deleted = isDeletedPlayer(player);

  const canLink = linkToProfile && player.displayName && !anonymous && !deleted;

  const nameContent = (
    <>
      {player.displayName ?? t("player")}
      {isYou && <span className="opacity-60"> {t("you")}</span>}
      {player.rating != null && (
        <span className="ml-1 text-xs font-normal opacity-50">({player.rating})</span>
      )}
    </>
  );

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <PlayerOverviewAvatar player={player} anonymous={anonymous} className={avatarClassName} />
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-1">
            {canLink ? (
              <Link
                href={`/profile/${encodeURIComponent(player.displayName!)}`}
                className={cn(
                  "truncate text-sm font-medium leading-tight hover:underline",
                  nameClassName,
                )}
              >
                {nameContent}
              </Link>
            ) : (
              <span className={cn("truncate text-sm font-medium leading-tight", nameClassName)}>
                {nameContent}
              </span>
            )}
            {anonymous && (
              <InfoTooltip
                text={t("guestPlayerTooltip")}
                className="shrink-0"
                iconClassName="opacity-50"
              />
            )}
            {deleted && (
              <InfoTooltip
                text={t("deletedPlayerTooltip")}
                className={cn(
                  "shrink-0",
                  friendVariant === "light"
                    ? "text-black/40 hover:text-black/60"
                    : "text-white/40 hover:text-white/60",
                )}
              />
            )}
          </div>
          {badgesToShow.length > 0 &&
            (isDevFeatureEnabled() ? (
              <div className="flex min-w-0 flex-wrap items-center gap-1 overflow-hidden">
                {badgesToShow.map((id) => (
                  <Link
                    key={id}
                    href={`/shop#badge-${id}`}
                    className="hover:opacity-80 transition-opacity"
                  >
                    <UserBadge badge={id as BadgeId} compact />
                  </Link>
                ))}
              </div>
            ) : (
              <div className="flex min-w-0 flex-wrap items-center gap-1 overflow-hidden">
                {badgesToShow.map((id) => (
                  <UserBadge key={id} badge={id as BadgeId} compact />
                ))}
              </div>
            ))}
        </div>
      </div>

      {online != null && <ConnectionDot online={online} />}

      {showFriendBadge && (
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            friendVariant === "light" ? "bg-black/10 text-black/60" : "bg-white/20",
          )}
        >
          {t("friend")}
        </span>
      )}

      {showPending && !deleted && (
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
          {t("pending")}
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

      {showAddFriend && onAddFriend && !deleted && (
        <button
          type="button"
          title={t("addFriend")}
          className={cn(
            "flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold transition-colors disabled:opacity-50",
            friendVariant === "light"
              ? "bg-black/10 text-black/70 hover:bg-black/20"
              : "bg-white/20 hover:bg-white/35",
          )}
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
          {t("addFriend")}
        </button>
      )}

      {children}
    </div>
  );
}
