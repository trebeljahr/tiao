import type { MultiplayerGameSummary, PlayerColor } from "@shared";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ColorDot,
  ScoreTargetIcon,
  translatePlayerColor,
  formatGameTimestamp,
  describeResult,
  getPlayerResult,
  EmptySeatAvatar,
} from "./GameShared";
import { GameConfigBadge } from "./GameConfigBadge";
import { CopyGameIdButton } from "./CopyGameIdButton";
import { formatClockTime } from "./GameClock";
import { cn } from "@/lib/utils";
import { PlayerIdentityRow } from "@/components/PlayerIdentityRow";

type MatchHistoryCardProps = {
  game: MultiplayerGameSummary;
  playerId: string;
  /** When set, results are described in third person ("{name} forfeited") */
  playerName?: string;
  onReview: () => void;
};

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
    <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2.5">
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
      {clockMs != null && (
        <span className="hidden items-center gap-1 font-mono text-xs tabular-nums text-[#6b5a45] sm:flex">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            fill="currentColor"
            className="h-3 w-3 opacity-50"
          >
            <path
              fillRule="evenodd"
              d="M1 8a7 7 0 1 1 14 0A7 7 0 0 1 1 8Zm7.75-4.25a.75.75 0 0 0-1.5 0V8c0 .414.336.75.75.75h3.25a.75.75 0 0 0 0-1.5h-2.5v-3.5Z"
              clipRule="evenodd"
            />
          </svg>
          {formatClockTime(clockMs)}
        </span>
      )}
      <span
        className={cn(
          "inline-flex items-center gap-1 font-mono text-sm tabular-nums",
          isWinner ? "font-bold text-[#1a1008]" : "text-[#6b5a45]",
        )}
      >
        <ScoreTargetIcon className="opacity-50" />
        {score}
        <span className="text-xs font-normal opacity-50">/{scoreToWin}</span>
      </span>
    </div>
  );

  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-xl px-3 py-2">
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

export function MatchHistoryCard({ game, playerId, playerName, onReview }: MatchHistoryCardProps) {
  const t = useTranslations("game");
  const tCommon = useTranslations("common");
  const locale = useLocale();
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
    return describeResult(result, game.finishReason, t, playerName) || null;
  })();

  return (
    <div className={cn("overflow-hidden rounded-2xl border p-3 space-y-3 sm:p-4", resultBg)}>
      {/* Header: result badge + reason + actions */}
      <div className="flex flex-wrap items-start justify-between gap-2">
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
          <CopyGameIdButton gameId={game.gameId} />
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
          {formatGameTimestamp(game.updatedAt, locale)} |{" "}
          {tCommon("moves", { count: game.historyLength ?? 0 })}
        </span>
        <GameConfigBadge
          boardSize={game.boardSize}
          scoreToWin={game.scoreToWin}
          timeControl={game.timeControl}
          roomType={game.roomType}
          showAll
          compact
        />
      </div>
    </div>
  );
}
