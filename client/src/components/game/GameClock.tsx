import { useState, useEffect, useRef } from "react";
import type { ClockState, PlayerColor, MultiplayerStatus } from "@shared";
import { cn } from "@/lib/utils";

export function formatClockTime(ms: number): string {
  if (ms <= 0) return "0:00";
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function useGameClock(
  clock: ClockState | null,
  currentTurn: PlayerColor,
  status: MultiplayerStatus,
): { whiteTime: number; blackTime: number } {
  const [, setTick] = useState(0);

  const isActive = status === "active" && clock !== null;

  useEffect(() => {
    if (!isActive) return;

    const interval = setInterval(() => {
      setTick(Date.now());
    }, 100);

    return () => clearInterval(interval);
  }, [isActive]);

  if (!clock) {
    return { whiteTime: 0, blackTime: 0 };
  }

  const lastMoveTime = new Date(clock.lastMoveAt).getTime();
  const elapsed = isActive ? Math.max(0, Date.now() - lastMoveTime) : 0;

  return {
    whiteTime:
      currentTurn === "white" && isActive
        ? Math.max(0, clock.white - elapsed)
        : clock.white,
    blackTime:
      currentTurn === "black" && isActive
        ? Math.max(0, clock.black - elapsed)
        : clock.black,
  };
}

/** Returns remaining ms until the first-move deadline, or null if not applicable. */
export function useFirstMoveCountdown(
  firstMoveDeadline: string | null,
  status: MultiplayerStatus,
): number | null {
  const [, setTick] = useState(0);

  const isActive = status === "active" && firstMoveDeadline !== null;

  useEffect(() => {
    if (!isActive) return;

    const interval = setInterval(() => {
      setTick(Date.now());
    }, 100);

    return () => clearInterval(interval);
  }, [isActive]);

  if (!firstMoveDeadline) return null;

  const deadline = new Date(firstMoveDeadline).getTime();
  return Math.max(0, deadline - Date.now());
}

/** Inline clock badge for use in the "Your move" header pill. */
export function InlineClockBadge({
  timeMs,
  className,
}: {
  timeMs: number;
  className?: string;
}) {
  const lowTime = timeMs < 30_000 && timeMs > 0;
  const criticalTime = timeMs < 10_000 && timeMs > 0;

  return (
    <span
      className={cn(
        "ml-1.5 font-mono text-sm tabular-nums",
        criticalTime
          ? "text-red-600 font-bold"
          : lowTime
            ? "text-amber-700 font-semibold"
            : "opacity-80",
        className,
      )}
    >
      {formatClockTime(timeMs)}
    </span>
  );
}
