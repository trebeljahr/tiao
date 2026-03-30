import type { MultiplayerGameSummary, PlayerColor } from "@shared";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  translatePlayerColor,
  formatGameTimestamp,
  describeResult,
  getPlayerResult,
  EmptySeatAvatar,
} from "./GameShared";
import { GameConfigBadge } from "./GameConfigBadge";
import { formatClockTime } from "./GameClock";
import { cn } from "@/lib/utils";
import { PlayerIdentityRow } from "@/components/PlayerIdentityRow";

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
  currentPlayerId,
  isWinner,
  clockMs,
  ratingChange,
  winnerLabel,
  unknownLabel,
  anonymous,
}: {
  player: {
    playerId?: string;
    displayName?: string;
    profilePicture?: string;
    activeBadges?: string[];
  } | null;
  color: PlayerColor;
  score: number;
  scoreToWin: number;
  currentPlayerId?: string;
  isWinner: boolean;
  clockMs?: number | null;
  ratingChange?: number | null;
  winnerLabel: string;
  unknownLabel: string;
  anonymous?: boolean;
}) {
  const gameStats = (
    <>
      {isWinner && (
        <span className="rounded-full bg-[#e8dcc6] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#6b5630]">
          {winnerLabel}
        </span>
      )}
      {ratingChange != null && (
        <span
          className={cn(
            "text-xs font-semibold tabular-nums",
            ratingChange > 0
              ? "text-[#2a6310]"
              : ratingChange < 0
                ? "text-[#9a2e26]"
                : "text-[#6b5a45]",
          )}
        >
          {ratingChange > 0 ? "+" : ""}
          {ratingChange}
        </span>
      )}
      <span
        className={cn(
          "font-mono text-sm tabular-nums",
          isWinner ? "font-bold text-[#1a1008]" : "text-[#6b5a45]",
        )}
      >
        {score}
        <span className="text-xs font-normal opacity-50">/{scoreToWin}</span>
      </span>
      {clockMs != null && (
        <span className="font-mono text-xs tabular-nums text-[#6b5a45]">
          {formatClockTime(clockMs)}
        </span>
      )}
    </>
  );

  return (
    <div className="flex items-center gap-2.5 rounded-xl px-3 py-2">
      <ColorDot color={color} />
      {player ? (
        <PlayerIdentityRow
          player={player}
          anonymous={anonymous}
          currentPlayerId={currentPlayerId}
          avatarClassName="h-6 w-6"
          friendVariant="light"
          className="min-w-0 flex-1"
          nameClassName="text-sm font-medium text-[#1a1008]"
        >
          {gameStats}
        </PlayerIdentityRow>
      ) : (
        <>
          <EmptySeatAvatar className="h-6 w-6" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#1a1008]">
            {unknownLabel}
          </span>
          {gameStats}
        </>
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
  const whitePlayer = game.seats?.white?.player ?? null;
  const blackPlayer = game.seats?.black?.player ?? null;
  const whiteWon = game.winner === "white";
  const blackWon = game.winner === "black";
  const scoreToWin = game.scoreToWin ?? 10;
  const whiteScore = game.score?.white ?? 0;
  const blackScore = game.score?.black ?? 0;

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
    if (game.finishReason === "captured" && whiteScore < scoreToWin && blackScore < scoreToWin) {
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
                result === "won" ? "bg-[#1a5c0a] text-white" : "bg-[#7f1d1d] text-white",
              )}
            >
              {result === "won" ? t("won") : t("lost")}
            </Badge>
          )}
          {!result && game.winner && (
            <Badge className="bg-[#e8dcc6] text-[#5a4a32] text-xs font-semibold">
              {t("colorWon", { color: translatePlayerColor(game.winner, t) ?? "" })}
            </Badge>
          )}
          {reasonText && <span className="text-xs text-[#4a3928]">{reasonText}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            className="rounded-md px-1.5 py-0.5 font-mono text-[10px] text-[#b5a48e] transition-colors hover:bg-black/5 hover:text-[#6e5b48]"
            onClick={onCopy}
            title={`Copy game ID: ${game.gameId}`}
          >
            {copiedId === game.gameId ? tCommon("copied") : game.gameId}
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
          score={whiteScore}
          scoreToWin={scoreToWin}
          currentPlayerId={playerId}
          isWinner={whiteWon}
          clockMs={game.clockMs?.white}
          ratingChange={whiteRatingChange}
          winnerLabel={t("winner")}
          unknownLabel={t("unknownPlayer")}
          anonymous={game.seats?.white?.player.kind === "guest"}
        />
        <PlayerRow
          player={blackPlayer}
          color="black"
          score={blackScore}
          scoreToWin={scoreToWin}
          currentPlayerId={playerId}
          isWinner={blackWon}
          clockMs={game.clockMs?.black}
          ratingChange={blackRatingChange}
          winnerLabel={t("winner")}
          unknownLabel={t("unknownPlayer")}
          anonymous={game.seats?.black?.player.kind === "guest"}
        />
      </div>

      {/* Footer: timestamp left, game settings pills right */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-[#6b5a45]">
          {formatGameTimestamp(game.updatedAt)} ·{" "}
          {tCommon("moves", { count: game.historyLength ?? 0 })}
        </span>
        <div className="flex items-center gap-1.5">
          {game.boardSize && game.boardSize !== 19 && (
            <span className="rounded-full border border-[#d7c39e] bg-[#fff9ef] px-2 py-0.5 text-[10px] font-medium text-[#6b5a45]">
              {game.boardSize}x{game.boardSize}
            </span>
          )}
          {game.timeControl && (
            <span className="rounded-full border border-[#d7c39e] bg-[#fff9ef] px-2 py-0.5 text-[10px] font-medium text-[#6b5a45]">
              {Math.floor(game.timeControl.initialMs / 60_000)}+
              {Math.round(game.timeControl.incrementMs / 1_000)}
            </span>
          )}
          {game.scoreToWin && game.scoreToWin !== 10 && (
            <span className="rounded-full border border-[#d7c39e] bg-[#fff9ef] px-2 py-0.5 text-[10px] font-medium text-[#6b5a45]">
              {t("nPts", { n: game.scoreToWin })}
            </span>
          )}
          <GameConfigBadge roomType={game.roomType} />
        </div>
      </div>
    </div>
  );
}
