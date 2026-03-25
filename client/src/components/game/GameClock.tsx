import { useState, useEffect, useRef } from "react";
import type { ClockState, PlayerColor, TimeControl, MultiplayerStatus } from "@shared";
import { cn } from "@/lib/utils";

type GameClockProps = {
  clock: ClockState | null;
  timeControl: TimeControl;
  currentTurn: PlayerColor;
  status: MultiplayerStatus;
  playerSeat: PlayerColor | null;
};

export function GameClock({
  clock,
  timeControl,
  currentTurn,
  status,
  playerSeat,
}: GameClockProps) {
  const { whiteTime, blackTime } = useGameClock(clock, currentTurn, status);

  if (!timeControl || !clock) return null;

  return (
    <div className="grid grid-cols-2 gap-3">
      <ClockTile
        label="Black"
        timeMs={blackTime}
        active={status === "active" && currentTurn === "black"}
        isPlayer={playerSeat === "black"}
        className="rounded-3xl border border-black/10 bg-[linear-gradient(180deg,#39312b,#14100d)] p-4 text-[#f9f2e8]"
        labelClassName="text-xs uppercase tracking-[0.24em] text-[#d9cec2]"
        timeClassName="text-[#f9f2e8]"
      />
      <ClockTile
        label="White"
        timeMs={whiteTime}
        active={status === "active" && currentTurn === "white"}
        isPlayer={playerSeat === "white"}
        className="rounded-3xl border border-[#d3c3ad] bg-[linear-gradient(180deg,#fffef8,#efe4d1)] p-4 text-[#2b1e14]"
        labelClassName="text-xs uppercase tracking-[0.24em] text-[#847261]"
        timeClassName="text-[#2b1e14]"
      />
    </div>
  );
}

function ClockTile({
  label,
  timeMs,
  active,
  isPlayer,
  className,
  labelClassName,
  timeClassName,
}: {
  label: string;
  timeMs: number;
  active: boolean;
  isPlayer: boolean;
  className: string;
  labelClassName: string;
  timeClassName: string;
}) {
  const lowTime = timeMs < 30_000 && timeMs > 0;
  const criticalTime = timeMs < 10_000 && timeMs > 0;
  const flagged = timeMs <= 0;

  return (
    <div
      className={cn(
        className,
        active && "ring-2 ring-offset-1",
        active && !lowTime && !criticalTime && "ring-[#b8cc8f]",
        lowTime && !criticalTime && "ring-amber-400",
        criticalTime && "ring-red-500",
        flagged && "opacity-60",
      )}
    >
      <p className={cn(labelClassName)}>{label}{isPlayer ? " (You)" : ""}</p>
      <p
        className={cn(
          "text-2xl font-mono font-bold tabular-nums",
          timeClassName,
          criticalTime && !flagged && "text-red-400",
          flagged && "text-red-400",
        )}
      >
        {formatClockTime(timeMs)}
      </p>
    </div>
  );
}

function formatClockTime(ms: number): string {
  if (ms <= 0) return "0:00";
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function useGameClock(
  clock: ClockState | null,
  currentTurn: PlayerColor,
  status: MultiplayerStatus,
): { whiteTime: number; blackTime: number } {
  const [tick, setTick] = useState(0);
  const rafRef = useRef<number>(0);

  const isActive = status === "active" && clock !== null;

  useEffect(() => {
    if (!isActive) return;

    const loop = () => {
      setTick(Date.now());
      rafRef.current = requestAnimationFrame(loop);
    };

    // Update at ~10fps for efficiency
    const interval = setInterval(() => {
      setTick(Date.now());
    }, 100);

    return () => {
      clearInterval(interval);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isActive]);

  if (!clock) {
    return { whiteTime: 0, blackTime: 0 };
  }

  // Compute live times based on server clock data
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
