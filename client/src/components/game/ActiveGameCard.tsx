import { PlayerIdentityRow } from "@/components/PlayerIdentityRow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MultiplayerGameSummary } from "@shared";
import { useTranslations } from "next-intl";
import { CopyGameIdButton } from "./CopyGameIdButton";
import { formatClockTime } from "./GameClock";
import { GameConfigBadge } from "./GameConfigBadge";
import {
  ColorDot,
  ScoreTargetIcon,
  getSummaryStatusLabel,
  isSummaryYourTurn,
  translatePlayerColor,
} from "./GameShared";

/** Small clock badge (icon + mm:ss) matching MatchHistoryCard's gameStats row.
 *  When clockMs is null (unlimited games), renders an infinity symbol. */
function ClockPill({ clockMs, muted = false }: { clockMs: number | null; muted?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-mono text-xs tabular-nums",
        muted ? "text-[#8d7760]" : "text-[#6b563e]",
      )}
    >
      <svg
        aria-hidden="true"
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
      {clockMs != null ? formatClockTime(clockMs) : "∞"}
    </span>
  );
}

type ActiveGameCardProps = {
  game: MultiplayerGameSummary;
  onResume: () => void;
  onDelete?: () => void;
  deleting?: boolean;
  onCancelRematch?: () => void;
  cancellingRematch?: boolean;
  "data-testid"?: string;
};

export function ActiveGameCard({
  game,
  onResume,
  onDelete,
  deleting,
  onCancelRematch,
  cancellingRematch,
  "data-testid": testId,
}: ActiveGameCardProps) {
  const tCommon = useTranslations("common");
  const tGame = useTranslations("game");
  const tLobby = useTranslations("lobby");

  const isYourTurn = isSummaryYourTurn(game);
  const isWaiting = game.status === "waiting";
  const hasRematchRequest = game.status === "finished" && !!game.rematch?.requestedBy.length;
  const youRequestedRematch =
    hasRematchRequest && game.yourSeat != null && game.rematch!.requestedBy.includes(game.yourSeat);
  const incomingRematch = hasRematchRequest && !youRequestedRematch;
  const opponent = game.yourSeat === "white" ? game.seats.black?.player : game.seats.white?.player;
  const opponentSeat = game.yourSeat === "white" ? "black" : "white";
  const opponentOnline = game.seats[opponentSeat]?.online ?? false;
  const yourColor = translatePlayerColor(game.yourSeat ?? null, tGame) ?? game.yourSeat;
  const yourScore = game.yourSeat === "white" ? game.score.white : game.score.black;
  const opponentScore = game.yourSeat === "white" ? game.score.black : game.score.white;
  const scoreToWin = game.scoreToWin ?? 10;
  const yourClockMs = game.clockMs && game.yourSeat ? game.clockMs[game.yourSeat] : null;
  const opponentClockMs = game.clockMs && game.yourSeat ? game.clockMs[opponentSeat] : null;

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
      {/* Row 0: game settings pills + resume.
          Mobile: settings on top, buttons on their own row below, LEFT-aligned.
          sm+: single row, buttons pushed to the right. */}
      <div className="flex flex-col items-stretch gap-2 pb-1 sm:flex-row sm:items-center sm:justify-between">
        <GameConfigBadge
          boardSize={game.boardSize}
          scoreToWin={game.scoreToWin}
          timeControl={game.timeControl}
          roomType={game.roomType}
          showAll
          compact
        />
        <div className="flex items-center justify-start gap-2 sm:justify-end">
          {isWaiting && onDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="text-[#a0887a] hover:text-[#8b3a2a] hover:bg-red-50"
              onClick={onDelete}
              disabled={deleting}
            >
              {deleting ? (
                "…"
              ) : (
                <>
                  <svg
                    aria-hidden="true"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    className="h-3.5 w-3.5"
                  >
                    <path
                      fillRule="evenodd"
                      d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5A.75.75 0 0 1 9.95 6Z"
                      clipRule="evenodd"
                    />
                  </svg>
                  {tCommon("delete")}
                </>
              )}
            </Button>
          )}
          {youRequestedRematch && onCancelRematch && (
            <Button
              variant="ghost"
              size="sm"
              className="text-[#a0887a] hover:text-[#8b3a2a] hover:bg-red-50"
              onClick={onCancelRematch}
              disabled={cancellingRematch}
            >
              {cancellingRematch ? "…" : tCommon("cancel")}
            </Button>
          )}
          <CopyGameIdButton gameId={game.gameId} variant="white" />
          <Button size="sm" onClick={onResume}>
            {hasRematchRequest ? tCommon("view") : isWaiting ? tCommon("view") : tCommon("resume")}
          </Button>
        </div>
      </div>

      {/* Row 1: playing as color + (clock + your score).
          Grid layout: ColorDot | name | stats. Below sm the stats cell
          drops to its own row (col 2, row 2) so the score + remaining clock
          time stop squeezing the name on narrow viewports. */}
      {game.yourSeat && (
        <div className="grid min-w-0 grid-cols-[auto_1fr] items-center gap-x-1.5 gap-y-1 sm:grid-cols-[auto_1fr_auto]">
          <ColorDot color={game.yourSeat} className="h-2.5 w-2.5" />
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="text-xs text-[#6b563e]">{tCommon("playingAs", { color: "" })}</span>
            <span className="text-xs font-medium text-[#2b1e14]">{yourColor}</span>
          </div>
          <div className="col-span-2 flex items-center gap-2 sm:col-auto sm:col-span-1 sm:justify-self-end sm:gap-3">
            <ClockPill clockMs={yourClockMs} />
            <span aria-hidden className="text-[#6b563e]/40">
              |
            </span>
            <span className="inline-flex items-center gap-1 font-mono text-xs tabular-nums text-[#6b563e]">
              <ScoreTargetIcon className="opacity-50" />
              {yourScore}
              <span className="font-normal opacity-50">/{scoreToWin}</span>
            </span>
          </div>
        </div>
      )}

      {/* Row 2: vs. opponent (with PlayerIdentityRow) + (clock + opponent score).
          Same grid trick as Row 1 — stats drop below the name on mobile. */}
      {opponent && (
        <div className="grid min-w-0 grid-cols-[auto_1fr] items-center gap-x-1.5 gap-y-1 sm:grid-cols-[auto_1fr_auto]">
          <ColorDot color={game.yourSeat === "white" ? "black" : "white"} className="h-2.5 w-2.5" />
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 text-xs text-[#8d7760]">vs.</span>
            <PlayerIdentityRow
              player={opponent}
              linkToProfile
              anonymous={opponent.kind === "guest"}
              className="min-w-0"
              avatarClassName="h-5 w-5"
              nameClassName="text-xs"
            />
            {opponentOnline && (
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full bg-[#6ba34a]"
                title={tLobby("opponentOnline")}
              />
            )}
          </div>
          <div className="col-span-2 flex items-center gap-2 sm:col-auto sm:col-span-1 sm:justify-self-end sm:gap-3">
            <ClockPill clockMs={opponentClockMs} muted />
            <span aria-hidden className="text-[#8d7760]/50">
              |
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums text-[#8d7760]">
              <ScoreTargetIcon className="opacity-50" />
              {opponentScore}
              <span className="font-normal opacity-50">/{scoreToWin}</span>
            </span>
          </div>
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
            incomingRematch
              ? "bg-[#f5ead4] text-[#8d6a2f] animate-pulse"
              : youRequestedRematch
                ? "bg-[#f5ead4] text-[#8d6a2f]"
                : isYourTurn
                  ? "bg-[#e8f2d8] text-[#4b6537] animate-pulse"
                  : "bg-[#f3e7d5] text-[#6b563e]",
          )}
        >
          {incomingRematch
            ? tGame("rematchRequested")
            : youRequestedRematch
              ? tGame("rematchSent")
              : getSummaryStatusLabel(game, tGame)}
        </Badge>
        <span className="text-xs text-[#8d7760]">
          {tCommon("moves", { count: game.historyLength })}
        </span>
      </div>
    </div>
  );
}
