import React, { useRef, useEffect } from "react";
import type { TurnRecord } from "@shared";
import { formatTurnRecord, isBoardMove } from "@shared";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type MoveListProps = {
  history: TurnRecord[];
  currentMoveIndex: number | null;
  onSelectMove?: (index: number) => void;
  interactive?: boolean;
  /** When true, the navigation buttons are rendered externally (e.g. below the board). */
  hideNavButtons?: boolean;
};

/** Find the previous/next board move index, skipping non-move events (forfeit, win, timeout). */
function findPrevBoardMove(history: TurnRecord[], from: number): number {
  for (let i = from - 1; i >= 0; i--) {
    if (isBoardMove(history[i])) return i;
  }
  return -1; // before first move = initial state
}

function findNextBoardMove(history: TurnRecord[], from: number): number {
  for (let i = from + 1; i < history.length; i++) {
    if (isBoardMove(history[i])) return i;
  }
  return from; // no next board move
}

function findLastBoardMove(history: TurnRecord[]): number {
  for (let i = history.length - 1; i >= 0; i--) {
    if (isBoardMove(history[i])) return i;
  }
  return -1;
}

export function MoveListNavButtons({
  history,
  currentMoveIndex,
  onSelectMove,
}: {
  history: TurnRecord[];
  currentMoveIndex: number | null;
  onSelectMove: (index: number) => void;
}) {
  const lastBoardIdx = findLastBoardMove(history);
  const isAtOrBeyondEnd = currentMoveIndex !== null && currentMoveIndex >= lastBoardIdx;

  return (
    <div className="flex items-center justify-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 text-xs"
        onClick={() => onSelectMove(-1)}
        disabled={currentMoveIndex === null || currentMoveIndex < 0}
        aria-label="Go to start"
      >
        ⏮
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 text-xs"
        onClick={() =>
          onSelectMove(
            currentMoveIndex !== null ? findPrevBoardMove(history, currentMoveIndex) : -1,
          )
        }
        disabled={currentMoveIndex === null || currentMoveIndex < 0}
        aria-label="Previous move"
      >
        ◀
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 text-xs"
        onClick={() =>
          onSelectMove(currentMoveIndex !== null ? findNextBoardMove(history, currentMoveIndex) : 0)
        }
        disabled={currentMoveIndex === null || isAtOrBeyondEnd}
        aria-label="Next move"
      >
        ▶
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 text-xs"
        onClick={() => onSelectMove(lastBoardIdx)}
        disabled={currentMoveIndex === null || isAtOrBeyondEnd}
        aria-label="Go to end"
      >
        ⏭
      </Button>
    </div>
  );
}

export function MoveList({
  history,
  currentMoveIndex,
  onSelectMove,
  interactive = false,
  hideNavButtons = false,
}: MoveListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (activeRef.current && scrollRef.current) {
      // Only scroll within the move list container, not the page
      const container = scrollRef.current;
      const element = activeRef.current;
      const containerRect = container.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();

      if (elementRect.top < containerRect.top) {
        container.scrollTop -= containerRect.top - elementRect.top;
      } else if (elementRect.bottom > containerRect.bottom) {
        container.scrollTop += elementRect.bottom - containerRect.bottom;
      }
    }
  }, [currentMoveIndex]);

  if (history.length === 0) {
    return <div className="py-4 text-center text-sm text-[#7a6656]">No moves yet.</div>;
  }

  // Pair moves into rows: [white, black?]
  const rows: Array<{
    index: number;
    white: { record: TurnRecord; idx: number };
    black?: { record: TurnRecord; idx: number };
  }> = [];
  let rowIndex = 0;
  for (let i = 0; i < history.length; i += 2) {
    rows.push({
      index: rowIndex++,
      white: { record: history[i], idx: i },
      black: history[i + 1] ? { record: history[i + 1], idx: i + 1 } : undefined,
    });
  }

  return (
    <div className="space-y-2" data-testid="move-list">
      {interactive && !hideNavButtons && onSelectMove && (
        <MoveListNavButtons
          history={history}
          currentMoveIndex={currentMoveIndex}
          onSelectMove={onSelectMove}
        />
      )}

      <div
        ref={scrollRef}
        className="max-h-48 overflow-y-auto rounded-xl border border-[#d8c29c] bg-[#fffaf1] px-2 py-1"
      >
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[#7a6656]">
              <th className="w-8 py-1 text-left font-medium">#</th>
              <th className="py-1 text-left font-medium">White</th>
              <th className="py-1 text-left font-medium">Black</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.index}>
                <td className="py-0.5 text-[#9b8a78] tabular-nums">{row.index + 1}</td>
                <td className="py-0.5">
                  <MoveCell
                    record={row.white.record}
                    moveIdx={row.white.idx}
                    isActive={currentMoveIndex === row.white.idx}
                    interactive={interactive}
                    onSelect={onSelectMove}
                    ref={currentMoveIndex === row.white.idx ? activeRef : undefined}
                  />
                </td>
                <td className="py-0.5">
                  {row.black && (
                    <MoveCell
                      record={row.black.record}
                      moveIdx={row.black.idx}
                      isActive={currentMoveIndex === row.black.idx}
                      interactive={interactive}
                      onSelect={onSelectMove}
                      ref={currentMoveIndex === row.black.idx ? activeRef : undefined}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type MoveCellProps = {
  record: TurnRecord;
  moveIdx: number;
  isActive: boolean;
  interactive: boolean;
  onSelect?: (index: number) => void;
};

const MoveCell = React.forwardRef<HTMLButtonElement, MoveCellProps>(function MoveCell(
  { record, moveIdx, isActive, interactive, onSelect },
  ref,
) {
  const label =
    record.type === "put"
      ? formatTurnRecord(record, moveIdx).replace(/^\d+\.\s\w\s/, "")
      : formatTurnRecord(record, moveIdx).replace(/^\d+\.\s\w\s/, "");

  if (!interactive) {
    return (
      <span
        className={cn(
          "inline-block rounded px-1.5 py-0.5 font-mono text-[#2b1e14]",
          isActive && "bg-[#e8dcc8] font-semibold",
        )}
      >
        {label}
      </span>
    );
  }

  return (
    <button
      ref={ref}
      type="button"
      onClick={() => onSelect?.(moveIdx)}
      className={cn(
        "inline-block cursor-pointer rounded px-1.5 py-0.5 font-mono text-[#2b1e14] transition-colors hover:bg-[#f0e6d4]",
        isActive && "bg-[#e8dcc8] font-semibold",
      )}
    >
      {label}
    </button>
  );
});
