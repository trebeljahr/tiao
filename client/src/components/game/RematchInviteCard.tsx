import type { MultiplayerRoomType, PlayerColor, TimeControl } from "@shared";
import { useTranslations } from "next-intl";
import { RematchInviteBody } from "@/components/game/RematchInviteBody";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

type RematchInviteCardProps = {
  opponent: {
    playerId?: string;
    displayName?: string;
    profilePicture?: string;
    activeBadges?: string[];
    rating?: number;
    online?: boolean | null;
    kind?: "account" | "guest";
  } | null;
  nextColor?: PlayerColor | null;
  boardSize?: number;
  scoreToWin?: number;
  timeControl?: TimeControl | null;
  roomType?: MultiplayerRoomType;
  currentPlayerId?: string;
  onAccept: () => void;
  onDecline: () => void;
  /**
   * Optional dismiss handler — renders an X button in the top-right corner.
   * Used by the sonner `toast.custom` surfaces, which bypass sonner's default
   * `closeButton` slot (that slot only wires up for the default
   * title/description layout, not custom bodies).
   */
  onDismiss?: () => void;
  busy?: boolean;
  /** Surfaces identifier used in data-testid + aria. */
  testId?: string;
  className?: string;
};

/**
 * Full rematch-invite card: identity body + accept/decline buttons inside the
 * tan-bordered container we use on the lobby. Identical visual treatment
 * regardless of whether it's rendered:
 *   - inline inside the lobby's "Invitations" card (LobbyPage)
 *   - inside a sonner toast via `toast.custom(() => <RematchInviteCard />)`
 *
 * Using `toast.custom` for sonner surfaces is important: sonner's default
 * title/description/button layout constraints the title column to ~200px
 * on a 356px toast after the action buttons steal their share of the flex
 * row, which used to squish the opponent row down to just "(1439)" with
 * the color pill dropped onto its own visual line. `toast.custom` bypasses
 * `data-styled=true` entirely and lets this card control every pixel.
 */
export function RematchInviteCard({
  opponent,
  nextColor,
  boardSize,
  scoreToWin,
  timeControl,
  roomType,
  currentPlayerId,
  onAccept,
  onDecline,
  onDismiss,
  busy,
  testId,
  className,
}: RematchInviteCardProps) {
  const tCommon = useTranslations("common");

  return (
    <div
      data-testid={testId}
      className={cn(
        "relative w-full max-w-sm space-y-3 rounded-2xl border border-[#d4b87a] bg-[#fdf6e8] p-4 shadow-[0_4px_16px_rgba(74,55,40,0.15)]",
        className,
      )}
    >
      {onDismiss && (
        <button
          type="button"
          aria-label={tCommon("close")}
          onClick={onDismiss}
          className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full text-[#6e5b48] transition-colors hover:bg-[#f0e2c5] hover:text-[#28170e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#af8a56]/60"
        >
          <CloseIcon />
        </button>
      )}
      <RematchInviteBody
        opponent={opponent}
        nextColor={nextColor}
        boardSize={boardSize}
        scoreToWin={scoreToWin}
        timeControl={timeControl}
        roomType={roomType}
        currentPlayerId={currentPlayerId}
      />
      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          variant="outline"
          className="flex-1 border-[#dcc7a2] hover:bg-[#faefd8]"
          onClick={onDecline}
          disabled={busy}
        >
          {tCommon("decline")}
        </Button>
        <Button size="sm" className="flex-1 shadow-xs" onClick={onAccept} disabled={busy}>
          {tCommon("accept")}
        </Button>
      </div>
    </div>
  );
}
