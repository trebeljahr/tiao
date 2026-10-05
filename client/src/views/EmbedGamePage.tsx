"use client";

import type { PublicGameReplay, TurnRecord } from "@shared";
import { isBoardMove, replayToMove } from "@shared";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { ColorDot, HourglassSpinner } from "@/components/game/GameShared";
import { MoveListNavButtons } from "@/components/game/MoveList";
import { TiaoBoard } from "@/components/game/TiaoBoard";
import { routing } from "@/i18n/routing";
import { ApiError, getGameReplay } from "@/lib/api";
import { useDynamicParam } from "@/lib/useDynamicParam";
import { cn } from "@/lib/utils";

type LoadError = "not-found" | "not-finished" | "unavailable";

function findLastBoardMove(history: TurnRecord[]): number {
  for (let i = history.length - 1; i >= 0; i--) {
    if (isBoardMove(history[i])) return i;
  }
  return -1;
}

function findPrevBoardMove(history: TurnRecord[], from: number): number {
  for (let i = from - 1; i >= 0; i--) {
    if (isBoardMove(history[i])) return i;
  }
  return -1;
}

function findNextBoardMove(history: TurnRecord[], from: number): number {
  for (let i = from + 1; i < history.length; i++) {
    if (isBoardMove(history[i])) return i;
  }
  return from;
}

/** 1-based ordinal of the board move at `index` (meta events don't count). */
function boardMoveOrdinal(history: TurnRecord[], index: number): number {
  let n = 0;
  for (let i = 0; i <= index && i < history.length; i++) {
    if (isBoardMove(history[i])) n++;
  }
  return n;
}

/**
 * Finished-game replay meant to run inside an <iframe> on a third-party
 * site. Deliberately self-contained: no navbar, no auth bootstrap, no
 * lobby socket — just the board, step controls, and a link back to the
 * full share page. Data comes from the public `/api/games/:id/replay`
 * endpoint because the session cookie never reaches a cross-site frame.
 */
export function EmbedGamePage() {
  const t = useTranslations("embed");
  const tGame = useTranslations("game");
  const locale = useLocale();
  const params = useParams<{ gameId: string }>();
  const gameId = useDynamicParam("game", params?.gameId);

  const [replay, setReplay] = useState<PublicGameReplay | null>(null);
  const [error, setError] = useState<LoadError | null>(null);
  const [moveIndex, setMoveIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;
    setReplay(null);
    setError(null);
    setMoveIndex(null);
    getGameReplay(gameId)
      .then(({ replay: loaded }) => {
        if (cancelled) return;
        setReplay(loaded);
        setMoveIndex(findLastBoardMove(loaded.history));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setError(err.code === "GAME_NOT_FINISHED" ? "not-finished" : "not-found");
        } else {
          setError("unavailable");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  const history = replay?.history ?? [];
  const lastBoardIdx = useMemo(() => findLastBoardMove(history), [history]);
  const totalMoves = useMemo(() => history.filter(isBoardMove).length, [history]);

  const displayState = useMemo(() => {
    if (!replay || moveIndex === null) return null;
    return replayToMove(replay.history, moveIndex, {
      boardSize: replay.boardSize,
      scoreToWin: replay.scoreToWin,
    });
  }, [replay, moveIndex]);

  const lastMove = useMemo(() => {
    if (!replay || moveIndex === null || moveIndex < 0) return null;
    const rec = replay.history[moveIndex];
    return rec && isBoardMove(rec) ? rec : null;
  }, [replay, moveIndex]);

  // Arrow keys step through the game once the frame has focus.
  useEffect(() => {
    if (!replay || moveIndex === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setMoveIndex((i) => (i === null ? i : findPrevBoardMove(history, i)));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setMoveIndex((i) => (i === null ? i : findNextBoardMove(history, i)));
      } else if (event.key === "Home") {
        event.preventDefault();
        setMoveIndex(-1);
      } else if (event.key === "End") {
        event.preventDefault();
        setMoveIndex(lastBoardIdx);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [replay, moveIndex, history, lastBoardIdx]);

  const localePrefix = locale === routing.defaultLocale ? "" : `/${locale}`;
  const fullGameHref = gameId ? `${localePrefix}/game/${encodeURIComponent(gameId)}` : "/";

  const winnerName = replay?.winner
    ? (replay[replay.winner]?.displayName ?? tGame(replay.winner))
    : null;

  return (
    <div
      className="flex min-h-dvh flex-col bg-[#f6ecd9] text-[#2b1e14]"
      data-testid="embed-game"
      data-game-id={gameId ?? ""}
    >
      <header className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
        {replay ? (
          <div
            className="flex min-w-0 items-center gap-2 font-semibold"
            data-testid="embed-players"
          >
            <ColorDot color="white" />
            <span className="truncate">{replay.white?.displayName ?? "?"}</span>
            <span className="font-mono tabular-nums text-[#7b6550]">
              {replay.score.white}–{replay.score.black}
            </span>
            <span className="truncate">{replay.black?.displayName ?? "?"}</span>
            <ColorDot color="black" />
          </div>
        ) : (
          <span className="text-[#7b6550]">{t("loading")}</span>
        )}
        <a
          href={fullGameHref}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-full border border-black/10 bg-[linear-gradient(180deg,#39312b,#16110d)] px-3 py-1 text-xs font-semibold text-[#f9f2e8] hover:-translate-y-0.5"
          data-testid="embed-open-link"
        >
          {t("openOnTiao")} ↗
        </a>
      </header>

      <main className="flex flex-1 items-center justify-center px-3">
        {displayState ? (
          <div
            className="relative isolate w-full max-w-[min(100%,calc(100dvh-7rem))]"
            data-testid="embed-board"
          >
            <TiaoBoard
              state={displayState}
              selectedPiece={null}
              jumpTargets={[]}
              confirmReady={true}
              lastMove={lastMove}
              disabled
            />
          </div>
        ) : error ? (
          <p className="max-w-sm text-center text-sm text-[#7b6550]" data-testid="embed-error">
            {error === "not-finished"
              ? t("notAvailable")
              : error === "not-found"
                ? t("notFound")
                : t("unavailable")}
          </p>
        ) : (
          <div className="flex items-center gap-2 text-sm text-[#7b6550]">
            <HourglassSpinner />
            {t("loading")}
          </div>
        )}
      </main>

      <footer
        className={cn(
          "flex items-center justify-between gap-3 px-3 py-2 text-xs text-[#7b6550]",
          !replay && "invisible",
        )}
      >
        <span className="truncate" data-testid="embed-result">
          {winnerName ? t("wins", { name: winnerName }) : ""}
        </span>
        {replay && moveIndex !== null && (
          <div
            className="flex items-center gap-2 rounded-full border border-[#d8c29c] bg-[#fff8ee]/96 px-2 py-1"
            data-testid="review-nav-buttons"
          >
            <MoveListNavButtons
              history={replay.history}
              currentMoveIndex={moveIndex}
              onSelectMove={setMoveIndex}
            />
            <span className="font-mono tabular-nums" data-testid="embed-move-counter">
              {t("moveOf", {
                current: moveIndex < 0 ? 0 : boardMoveOrdinal(replay.history, moveIndex),
                total: totalMoves,
              })}
            </span>
          </div>
        )}
      </footer>
    </div>
  );
}
