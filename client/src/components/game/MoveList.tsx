import React, { useRef, useEffect } from "react";
import type { TurnRecord } from "@shared";
import { formatTurnRecord } from "@shared";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type MoveListProps = {
  history: TurnRecord[];
  currentMoveIndex: number | null;
  onSelectMove?: (index: number) => void;
  interactive?: boolean;
};

export function MoveList({
  history,
  currentMoveIndex,
  onSelectMove,
  interactive = false,
}: MoveListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (activeRef.current?.scrollIntoView && scrollRef.current) {
      activeRef.current.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    }
  }, [currentMoveIndex]);

  if (history.length === 0) {
    return (
      <div className="py-4 text-center text-sm text-[#7a6656]">
        No moves yet.
      </div>
    );
  }

  // Pair moves into rows: [white, black?]
  const rows: Array<{ index: number; white: { record: TurnRecord; idx: number }; black?: { record: TurnRecord; idx: number } }> = [];
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
      {interactive && (
        <div className="flex items-center justify-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-xs"
            onClick={() => onSelectMove?.(-1)}
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
              onSelectMove?.(
                currentMoveIndex !== null ? currentMoveIndex - 1 : -1,
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
              onSelectMove?.(
                currentMoveIndex !== null
                  ? currentMoveIndex + 1
                  : 0,
              )
            }
            disabled={
              currentMoveIndex === null ||
              currentMoveIndex >= history.length - 1
            }
            aria-label="Next move"
          >
            ▶
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-xs"
            onClick={() => onSelectMove?.(history.length - 1)}
            disabled={
              currentMoveIndex === null ||
              currentMoveIndex >= history.length - 1
            }
            aria-label="Go to end"
          >
            ⏭
          </Button>
        </div>
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
                <td className="py-0.5 text-[#9b8a78] tabular-nums">
                  {row.index + 1}
                </td>
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

const MoveCell = React.forwardRef<HTMLButtonElement, MoveCellProps>(
  function MoveCell({ record, moveIdx, isActive, interactive, onSelect }, ref) {
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
  },
);
