import type { MultiplayerGameSummary } from "@shared";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ColorDot,
  getSummaryStatusLabel,
  isSummaryYourTurn,
  translatePlayerColor,
} from "./GameShared";
import { GameConfigBadge } from "./GameConfigBadge";
import { PlayerIdentityRow } from "@/components/PlayerIdentityRow";
import { cn } from "@/lib/utils";

type ActiveGameCardProps = {
  game: MultiplayerGameSummary;
  onResume: () => void;
  onDelete?: () => void;
  deleting?: boolean;
  "data-testid"?: string;
};

export function ActiveGameCard({
  game,
  onResume,
  onDelete,
  deleting,
  "data-testid": testId,
}: ActiveGameCardProps) {
  const tCommon = useTranslations("common");
  const tGame = useTranslations("game");

  const isYourTurn = isSummaryYourTurn(game);
  const isWaiting = game.status === "waiting";
  const hasRematchRequest = game.status === "finished" && !!game.rematch?.requestedBy.length;
  const opponent = game.yourSeat === "white" ? game.seats.black?.player : game.seats.white?.player;
  const opponentSeat = game.yourSeat === "white" ? "black" : "white";
  const opponentOnline = game.seats[opponentSeat]?.online ?? false;
  const yourColor = translatePlayerColor(game.yourSeat ?? null, tGame) ?? game.yourSeat;
  const yourScore = game.yourSeat === "white" ? game.score.white : game.score.black;
  const opponentScore = game.yourSeat === "white" ? game.score.black : game.score.white;
  const scoreToWin = game.scoreToWin ?? 10;

  return (
    <div
      data-testid={testId}
      className={cn(
        "flex flex-col gap-2 p-4 rounded-2xl border",
        hasRematchRequest
          ? "border-[#d4b87a] bg-[#fdf6e8]"
          : opponentOnline
            ? "border-[#b8cc8f] bg-[#f9fcf3]"
            : "border-[#d7c39e] bg-white/40",
      )}
    >
      {/* Row 0: game settings pills + resume */}
      <div className="flex items-center justify-between gap-2 pb-1">
        <GameConfigBadge
          boardSize={game.boardSize}
          scoreToWin={game.scoreToWin}
          timeControl={game.timeControl}
          roomType={game.roomType}
          showAll
          compact
        />
        <div className="flex items-center gap-2">
          {isWaiting && onDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="text-[#a0887a] hover:text-[#8b3a2a] hover:bg-red-50"
              onClick={onDelete}
              disabled={deleting}
            >
              {deleting ? "…" : tCommon("cancel")}
            </Button>
          )}
          <Button size="sm" onClick={onResume}>
            {hasRematchRequest ? tCommon("view") : isWaiting ? tCommon("view") : tCommon("resume")}
          </Button>
        </div>
      </div>

      {/* Row 1: playing as color + your score */}
      {game.yourSeat && (
        <div className="flex min-w-0 items-center gap-1.5">
          <ColorDot color={game.yourSeat} className="h-2.5 w-2.5" />
          <span className="text-xs text-[#6b563e]">{tCommon("playingAs", { color: "" })}</span>
          <span className="text-xs font-medium text-[#2b1e14]">{yourColor}</span>
          <span className="ml-auto font-mono text-xs tabular-nums text-[#6b563e]">
            {yourScore}
            <span className="font-normal opacity-50">/{scoreToWin}</span>
          </span>
        </div>
      )}

      {/* Row 2: vs. opponent (with PlayerIdentityRow) + opponent score */}
      {opponent && (
        <div className="flex min-w-0 items-center gap-1.5">
          <ColorDot color={game.yourSeat === "white" ? "black" : "white"} className="h-2.5 w-2.5" />
          <span className="shrink-0 text-xs text-[#8d7760]">vs.</span>
          <PlayerIdentityRow
            player={opponent}
            linkToProfile={false}
            className="min-w-0"
            avatarClassName="h-5 w-5"
            nameClassName="text-xs"
          />
          {opponentOnline && (
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full bg-[#6ba34a]"
              title={tGame("opponentOnline")}
            />
          )}
          <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-[#8d7760]">
            {opponentScore}
            <span className="font-normal opacity-50">/{scoreToWin}</span>
          </span>
        </div>
      )}
      {!opponent && isWaiting && (
        <span className="text-xs text-[#8d7760]">{tGame("waitingForOpponent")}</span>
      )}

      {/* Row 3: status badge */}
      <div className="flex items-center justify-between gap-2 pt-1.5">
        <Badge
          className={cn(
            "text-[10px]",
            hasRematchRequest
              ? "bg-[#f5ead4] text-[#8d6a2f] animate-pulse"
              : isYourTurn
                ? "bg-[#e8f2d8] text-[#4b6537] animate-pulse"
                : "bg-[#f3e7d5] text-[#6b563e]",
          )}
        >
          {hasRematchRequest ? tGame("rematchRequested") : getSummaryStatusLabel(game, tGame)}
        </Badge>
        <span className="text-xs text-[#8d7760]">
          {tCommon("moves", { count: game.historyLength })}
        </span>
      </div>
    </div>
  );
}
