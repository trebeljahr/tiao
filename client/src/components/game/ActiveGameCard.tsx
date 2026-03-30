import type { MultiplayerGameSummary } from "@shared";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GameConfigBadge } from "./GameConfigBadge";
import { getSummaryStatusLabel, isSummaryYourTurn, translatePlayerColor } from "./GameShared";
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
      {/* Row 1: playing as color + your score + resume */}
      <div className="flex items-center justify-between gap-2">
        {game.yourSeat && (
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className={cn(
                "inline-block h-2.5 w-2.5 shrink-0 rounded-full border",
                game.yourSeat === "white"
                  ? "border-[#ddd2bf] bg-[radial-gradient(circle_at_30%_28%,#fffdfa,#f4eee3_58%,#d9ccb8)]"
                  : "border-[#191410] bg-[radial-gradient(circle_at_30%_28%,#5d554f,#2d2622_58%,#0f0c0b)]",
              )}
            />
            <span className="text-xs text-[#6b563e]">{tCommon("playingAs", { color: "" })}</span>
            <span className="text-xs font-medium text-[#2b1e14]">{yourColor}</span>
            <span className="font-mono text-xs tabular-nums text-[#6b563e]">
              {yourScore}
              <span className="font-normal opacity-50">/{scoreToWin}</span>
            </span>
          </div>
        )}
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

      {/* Row 2: vs. opponent (with PlayerIdentityRow) + opponent score */}
      {opponent && (
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "inline-block h-2.5 w-2.5 shrink-0 rounded-full border",
              game.yourSeat === "white"
                ? "border-[#191410] bg-[radial-gradient(circle_at_30%_28%,#5d554f,#2d2622_58%,#0f0c0b)]"
                : "border-[#ddd2bf] bg-[radial-gradient(circle_at_30%_28%,#fffdfa,#f4eee3_58%,#d9ccb8)]",
            )}
          />
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

      {/* Game settings pills */}
      <div className="flex flex-wrap items-center gap-1.5">
        {game.boardSize && (
          <span className="rounded-full border border-[#d7c39e] bg-[#fff9ef] px-2 py-0.5 text-[10px] font-medium text-[#6b5a45]">
            {game.boardSize}x{game.boardSize}
          </span>
        )}
        {game.scoreToWin && (
          <span className="rounded-full border border-[#d7c39e] bg-[#fff9ef] px-2 py-0.5 text-[10px] font-medium text-[#6b5a45]">
            {tGame("nPts", { n: game.scoreToWin })}
          </span>
        )}
        {game.timeControl && (
          <span className="rounded-full border border-[#d7c39e] bg-[#fff9ef] px-2 py-0.5 text-[10px] font-medium text-[#6b5a45]">
            {Math.floor(game.timeControl.initialMs / 60_000)}+
            {Math.round(game.timeControl.incrementMs / 1_000)}
          </span>
        )}
        <GameConfigBadge roomType={game.roomType} />
      </div>

      {/* Row 3: status badge */}
      <div className="flex items-center justify-between gap-2 pt-0.5">
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
