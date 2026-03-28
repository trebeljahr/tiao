import { useState, useEffect, useCallback, useRef } from "react";
import type { TimeControl, PlayerColor, TurnRecord } from "@shared";

export type LocalClockState = {
  white: number;
  black: number;
  running: boolean;
  timedOut: PlayerColor | null;
};

/**
 * Client-side chess clock for local (over-the-board) timed games.
 * Tracks remaining time per side, switches on turn change, applies
 * increment after moves, and restores clock on undo using timestamps.
 */
export function useLocalClock(
  timeControl: TimeControl,
  currentTurn: PlayerColor,
  gameOver: boolean,
  history: TurnRecord[],
) {
  const [clock, setClock] = useState<LocalClockState>(() => ({
    white: timeControl?.initialMs ?? 0,
    black: timeControl?.initialMs ?? 0,
    running: false,
    timedOut: null,
  }));

  const lastTurnRef = useRef(currentTurn);
  const lastHistoryLenRef = useRef(history.length);
  const lastTickRef = useRef(Date.now());

  // Reset clock when timeControl changes (new game)
  useEffect(() => {
    setClock({
      white: timeControl?.initialMs ?? 0,
      black: timeControl?.initialMs ?? 0,
      running: false,
      timedOut: null,
    });
    lastTurnRef.current = currentTurn;
    lastHistoryLenRef.current = history.length;
    lastTickRef.current = Date.now();
  }, [timeControl?.initialMs, timeControl?.incrementMs]);

  // Detect turn change (forward move or undo)
  useEffect(() => {
    if (!timeControl || gameOver || clock.timedOut) return;
    const increment = timeControl.incrementMs ?? 0;

    if (history.length > lastHistoryLenRef.current && currentTurn !== lastTurnRef.current) {
      // Forward move: apply increment to the player who just moved
      const movedColor = lastTurnRef.current;
      setClock((prev) => ({
        ...prev,
        running: true,
        [movedColor]: prev[movedColor] + increment,
      }));
      lastTickRef.current = Date.now();
    } else if (history.length < lastHistoryLenRef.current) {
      // Undo: restore clock using timestamps (same logic as server takeback)
      // Find the move that was just undone — it was at index history.length
      // in the previous history (which is now gone).
      // We saved timestamps on each move, so we can reverse the clock.
      //
      // Since the move is already removed from history, we can't access it
      // directly. Instead, recalculate clocks from scratch using all
      // remaining timestamped moves.
      setClock((prev) => {
        const restored = recalculateClocks(timeControl, history);
        return {
          ...prev,
          ...restored,
          running: history.length > 0,
        };
      });
      lastTickRef.current = Date.now();
    }

    lastTurnRef.current = currentTurn;
    lastHistoryLenRef.current = history.length;
  }, [currentTurn, history, timeControl, gameOver, clock.timedOut]);

  // Start the clock after the first move
  useEffect(() => {
    if (!timeControl || gameOver || clock.timedOut) return;
    if (history.length > 0 && !clock.running) {
      setClock((prev) => ({ ...prev, running: true }));
      lastTickRef.current = Date.now();
    }
  }, [history.length, timeControl, gameOver, clock.timedOut, clock.running]);

  // Tick the clock every 100ms
  useEffect(() => {
    if (!timeControl || !clock.running || gameOver || clock.timedOut) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastTickRef.current;
      lastTickRef.current = now;

      setClock((prev) => {
        const newTime = Math.max(0, prev[currentTurn] - elapsed);
        const timedOut = newTime <= 0 ? currentTurn : null;
        return {
          ...prev,
          [currentTurn]: newTime,
          timedOut: timedOut ?? prev.timedOut,
          running: timedOut ? false : prev.running,
        };
      });
    }, 100);

    return () => clearInterval(interval);
  }, [timeControl, clock.running, clock.timedOut, currentTurn, gameOver]);

  // Stop clock when game is over
  useEffect(() => {
    if (gameOver) {
      setClock((prev) => ({ ...prev, running: false }));
    }
  }, [gameOver]);

  const reset = useCallback(() => {
    setClock({
      white: timeControl?.initialMs ?? 0,
      black: timeControl?.initialMs ?? 0,
      running: false,
      timedOut: null,
    });
    lastTickRef.current = Date.now();
  }, [timeControl]);

  return { clock, resetClock: reset };
}

/**
 * Recalculate clock state from scratch using move timestamps.
 * Replays the time deductions and increments for every timestamped
 * move in the history — the same approach the server uses for
 * takeback clock restoration.
 */
function recalculateClocks(
  timeControl: NonNullable<TimeControl>,
  history: TurnRecord[],
): { white: number; black: number } {
  let white = timeControl.initialMs;
  let black = timeControl.initialMs;
  const increment = timeControl.incrementMs ?? 0;

  let prevTimestamp: number | null = null;

  for (const rec of history) {
    if (rec.type !== "put" && rec.type !== "jump") continue;
    if (!rec.timestamp) continue;

    // Deduct elapsed time since previous move
    if (prevTimestamp !== null) {
      const elapsed = rec.timestamp - prevTimestamp;
      if (rec.color === "white") {
        white = Math.max(0, white - elapsed);
      } else {
        black = Math.max(0, black - elapsed);
      }
    }

    // Apply increment after the move
    if (rec.color === "white") {
      white += increment;
    } else {
      black += increment;
    }

    prevTimestamp = rec.timestamp;
  }

  return { white, black };
}
