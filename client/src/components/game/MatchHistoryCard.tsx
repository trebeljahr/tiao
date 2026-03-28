import type { MultiplayerGameSummary, PlayerColor } from "@shared";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  formatPlayerColor,
  formatGameTimestamp,
  describeResult,
  getPlayerResult,
  PlayerOverviewAvatar,
  EmptySeatAvatar,
} from "./GameShared";
import { GameConfigBadge } from "./GameConfigBadge";
import { formatClockTime } from "./GameClock";
import { cn } from "@/lib/utils";

type MatchHistoryCardProps = {
  game: MultiplayerGameSummary;
  playerId: string;
  copiedId: string | null;
  onCopy: () => void;
  onReview: () => void;
};

function ColorDot({ color }: { color: PlayerColor }) {
  return (
    <span
      className={cn(
        "inline-block h-4 w-4 shrink-0 rounded-full border",
        color === "white"
          ? "border-[#ddd2bf] bg-[radial-gradient(circle_at_30%_28%,#fffdfa,#f4eee3_58%,#d9ccb8)]"
          : "border-[#191410] bg-[radial-gradient(circle_at_30%_28%,#5d554f,#2d2622_58%,#0f0c0b)]",
      )}
    />
  );
}

function PlayerRow({
  player,
  color,
  score,
  scoreToWin,
  isYou,
  isWinner,
  clockMs,
  ratingChange,
  youLabel,
}: {
  player: { displayName?: string; profilePicture?: string } | null;
  color: PlayerColor;
  score: number;
  scoreToWin: number;
  isYou: boolean;
  isWinner: boolean;
  clockMs?: number | null;
  ratingChange?: number | null;
  youLabel: string;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl px-3 py-2">
      <ColorDot color={color} />
      {player ? (
        <PlayerOverviewAvatar player={player} className="h-6 w-6" />
      ) : (
        <EmptySeatAvatar className="h-6 w-6" />
      )}
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#2b1e14]">
        {player?.displayName ?? "Unknown"}
        {isYou && <span className="ml-1 text-[#8d7760]">{youLabel}</span>}
      </span>
      {isWinner && (
        <span className="rounded-full bg-[#e8dcc6] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#6b5630]">
          Winner
        </span>
      )}
      {ratingChange != null && (
        <span
          className={cn(
            "text-xs font-semibold tabular-nums",
            ratingChange > 0
              ? "text-[#3d7a1e]"
              : ratingChange < 0
                ? "text-[#b5443a]"
                : "text-[#9a8770]",
          )}
        >
          {ratingChange > 0 ? "+" : ""}
          {ratingChange}
        </span>
      )}
      <span
        className={cn(
          "font-mono text-sm tabular-nums",
          isWinner ? "font-bold text-[#2b1e14]" : "text-[#9a8770]",
        )}
      >
        {score}
        <span className="text-xs font-normal opacity-50">/{scoreToWin}</span>
      </span>
      {clockMs != null && (
        <span className="font-mono text-xs tabular-nums text-[#9a8770]">
          {formatClockTime(clockMs)}
        </span>
      )}
    </div>
  );
}

export function MatchHistoryCard({
  game,
  playerId,
  copiedId,
  onCopy,
  onReview,
}: MatchHistoryCardProps) {
  const t = useTranslations("game");
  const tCommon = useTranslations("common");
  const result = getPlayerResult(game);
  const whitePlayer = game.seats.white?.player ?? null;
  const blackPlayer = game.seats.black?.player ?? null;
  const isWhiteYou = whitePlayer?.playerId === playerId;
  const isBlackYou = blackPlayer?.playerId === playerId;
  const whiteWon = game.winner === "white";
  const blackWon = game.winner === "black";
  const scoreToWin = game.scoreToWin ?? 10;

  const whiteRatingChange =
    game.ratingBefore && game.ratingAfter ? game.ratingAfter.white - game.ratingBefore.white : null;
  const blackRatingChange =
    game.ratingBefore && game.ratingAfter ? game.ratingAfter.black - game.ratingBefore.black : null;

  const resultBg =
    result === "won"
      ? "border-[#a3c98a]/60 bg-[#f4fae9]"
      : result === "lost"
        ? "border-[#dba8a0]/60 bg-[#fdf3f1]"
        : "border-[#d7c39e] bg-white/40";

  // Only show reason if we actually have one and it makes sense
  const reasonText = (() => {
    if (!game.finishReason) return null;
    // Don't say "score target reached" if neither player actually reached it
    if (
      game.finishReason === "captured" &&
      game.score.white < scoreToWin &&
      game.score.black < scoreToWin
    ) {
      return null;
    }
    return describeResult(result, game.finishReason, t) || null;
  })();

  return (
    <div className={cn("rounded-2xl border p-4 space-y-3", resultBg)}>
      {/* Header: result badge + reason + actions */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {result && (
            <Badge
              className={cn(
                "text-xs font-bold border-0",
                result === "won" ? "bg-[#c2e4a4] text-[#1a4008]" : "bg-[#edb4ac] text-[#5c1a14]",
              )}
            >
              {result === "won" ? t("won") : t("lost")}
            </Badge>
          )}
          {!result && game.winner && (
            <Badge className="bg-[#e8dcc6] text-[#5a4a32] text-xs font-semibold">
              {t("colorWon", { color: formatPlayerColor(game.winner) ?? "" })}
            </Badge>
          )}
          {reasonText && <span className="text-xs text-[#6e5b48]">{reasonText}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            className="rounded-md px-1.5 py-0.5 font-mono text-[10px] text-[#b5a48e] transition-colors hover:bg-black/5 hover:text-[#6e5b48]"
            onClick={onCopy}
            title={`Copy game ID: ${game.gameId}`}
          >
            {copiedId === game.gameId ? "Copied" : game.gameId}
          </button>
          <Button size="sm" className="text-xs" onClick={onReview}>
            {tCommon("review")}
          </Button>
        </div>
      </div>

      {/* Player rows with scores */}
      <div className="space-y-1 rounded-xl border border-black/5 bg-white/50 p-1">
        <PlayerRow
          player={whitePlayer}
          color="white"
          score={game.score.white}
          scoreToWin={scoreToWin}
          isYou={isWhiteYou}
          isWinner={whiteWon}
          clockMs={game.clockMs?.white}
          ratingChange={whiteRatingChange}
          youLabel={tCommon("you")}
        />
        <PlayerRow
          player={blackPlayer}
          color="black"
          score={game.score.black}
          scoreToWin={scoreToWin}
          isYou={isBlackYou}
          isWinner={blackWon}
          clockMs={game.clockMs?.black}
          ratingChange={blackRatingChange}
          youLabel={tCommon("you")}
        />
      </div>

      {/* Footer: game info */}
      <div className="flex flex-wrap items-center gap-2">
        <GameConfigBadge
          boardSize={game.boardSize}
          scoreToWin={game.scoreToWin}
          timeControl={game.timeControl}
          roomType={game.roomType}
        />
        <span className="text-xs text-[#9a8770]">
          {formatGameTimestamp(game.updatedAt)} · {tCommon("moves", { count: game.historyLength })}
        </span>
      </div>
    </div>
  );
}
