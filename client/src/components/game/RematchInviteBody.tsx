import { PlayerIdentityRow } from "@/components/PlayerIdentityRow";
import { GameConfigBadge } from "@/components/game/GameConfigBadge";
import { ColorDot, translatePlayerColor } from "@/components/game/GameShared";
import { cn } from "@/lib/utils";
import type { MultiplayerRoomType, PlayerColor, TimeControl } from "@shared";
import { useTranslations } from "next-intl";

type RematchInviteOpponent = {
  playerId?: string;
  displayName?: string;
  profilePicture?: string;
  activeBadges?: string[];
  rating?: number;
  online?: boolean | null;
  kind?: "account" | "guest";
};

type RematchInviteBodyProps = {
  /** The opponent who requested (or will receive) the rematch. Null renders a generic fallback. */
  opponent: RematchInviteOpponent | null;
  /** The color the receiver will play in the rematch (flipped from their seat in the finished game). */
  nextColor?: PlayerColor | null;
  boardSize?: number;
  scoreToWin?: number;
  timeControl?: TimeControl | null;
  roomType?: MultiplayerRoomType;
  currentPlayerId?: string;
  className?: string;
};

/**
 * Unified body for rematch invites. Rendered inside:
 *  - the lobby's "Invitations" card (LobbyPage rematch row)
 *  - the global sonner toast in SocialNotificationsContext (via toast.custom)
 *  - the in-game sonner toast in MultiplayerGamePage (via toast.custom)
 *
 * All three surfaces now show the same information: opponent identity row,
 * color assignment pill, "wants a rematch!" label, and the full game config
 * (board size, score-to-win, time control, room type) via GameConfigBadge
 * with `showAll` so defaults (19×19, 10pts, unlimited) also surface —
 * rematch cards shouldn't hide settings just because they match the defaults.
 *
 * Layout: everything stacks vertically in its own row — no side-by-side
 * `justify-between` of opponent row + color pill. Side-by-side layouts
 * exploded inside narrow sonner toasts (~200px usable width) because the
 * color pill pushed PlayerIdentityRow's name column down to 0 width, so
 * users saw "(1439)" with no displayName next to it. Stacking is always safe.
 *
 * Actions (accept / decline buttons) are intentionally NOT part of this
 * component — use `RematchInviteCard` (same directory) to get the full
 * "body + buttons + styled wrapper" card, or compose inline.
 */
export function RematchInviteBody({
  opponent,
  nextColor,
  boardSize,
  scoreToWin,
  timeControl,
  roomType,
  currentPlayerId,
  className,
}: RematchInviteBodyProps) {
  const tLobby = useTranslations("lobby");
  const tCommon = useTranslations("common");
  const tGame = useTranslations("game");

  return (
    <div className={cn("min-w-0 space-y-2", className)}>
      {opponent ? (
        <PlayerIdentityRow
          player={opponent}
          currentPlayerId={currentPlayerId}
          linkToProfile={false}
          online={opponent.online ?? null}
          anonymous={opponent.kind === "guest"}
          avatarClassName="h-7 w-7 shrink-0"
          nameClassName="text-sm font-medium"
          className="min-w-0 gap-2"
        />
      ) : (
        <span className="text-sm text-[#6b5a45]">{tGame("rematchRequested")}</span>
      )}
      <p className="text-xs font-semibold text-[#8d6a2f]">{tLobby("rematchToastDesc")}</p>
      {nextColor && (
        <span className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-[#dcc7a3] bg-[#fff9ef] px-2 py-0.5 text-xs text-[#6b5a45]">
          <ColorDot color={nextColor} className="h-3 w-3" />
          {tCommon("wouldPlayAs", {
            color: translatePlayerColor(nextColor, tGame) ?? "",
          })}
        </span>
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs text-[#6b5a45]">
        <GameConfigBadge
          boardSize={boardSize}
          scoreToWin={scoreToWin}
          timeControl={timeControl ?? undefined}
          roomType={roomType}
          showAll
        />
      </div>
    </div>
  );
}
