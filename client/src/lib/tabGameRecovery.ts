import type { GameState } from "@shared";
import { useEffect, useRef } from "react";

/**
 * Tab-local recovery for games that exist only in the browser (hot-seat and
 * against the computer). A full reload — a release change, the service
 * worker's reload when the connection returns, or the user pressing reload —
 * would otherwise discard the board. Records live in sessionStorage, are
 * restored only when this document was a reload of the same URL, and are
 * removed when the page is left inside the app.
 */
const PREFIX = "tiao:tab-game:v1:";
const MAX_AGE_MS = 7 * 24 * 60 * 60_000;

type Saved<T> = { schema: 1; savedAt: number; path: string; data: T };

function currentPath(): string {
  return window.location.pathname + window.location.search;
}

function wasReload(): boolean {
  try {
    const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    return entry?.type === "reload";
  } catch {
    return false;
  }
}

export function isRecoverableGameState(value: unknown): value is GameState {
  const game = value as Partial<GameState> | null;
  return (
    !!game &&
    typeof game === "object" &&
    typeof game.boardSize === "number" &&
    Array.isArray(game.positions) &&
    game.positions.length === game.boardSize &&
    Array.isArray(game.history) &&
    Array.isArray(game.pendingJump) &&
    (game.currentTurn === "white" || game.currentTurn === "black") &&
    typeof game.score?.white === "number" &&
    typeof game.score?.black === "number"
  );
}

export function loadTabGame<T>(kind: string, validate: (data: unknown) => data is T): T | null {
  try {
    const raw = window.sessionStorage.getItem(PREFIX + kind);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<Saved<unknown>>;
    if (
      saved.schema === 1 &&
      typeof saved.savedAt === "number" &&
      Date.now() - saved.savedAt < MAX_AGE_MS &&
      saved.path === currentPath() &&
      validate(saved.data)
    )
      return saved.data;
  } catch {
    // Unreadable record: start fresh.
  }
  clearTabGame(kind);
  return null;
}

export function saveTabGame(kind: string, data: unknown): boolean {
  try {
    const saved: Saved<unknown> = { schema: 1, savedAt: Date.now(), path: currentPath(), data };
    window.sessionStorage.setItem(PREFIX + kind, JSON.stringify(saved));
    return true;
  } catch {
    return false;
  }
}

export function clearTabGame(kind: string): void {
  try {
    window.sessionStorage.removeItem(PREFIX + kind);
  } catch {
    // Storage unavailable: nothing to clear.
  }
}

/**
 * Restores a saved game once after a reload, then keeps the record current.
 * `snapshot` is null while there is nothing worth saving (setup dialog open,
 * computer mid-move); the previous record is kept in that case.
 */
export function useTabGameRecovery<T>(
  kind: string,
  snapshot: T | null,
  validate: (data: unknown) => data is T,
  onRestore: (data: T) => void,
): void {
  const ready = useRef(false);
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;

  const skipStaleSave = useRef(false);

  useEffect(() => {
    if (wasReload()) {
      const data = loadTabGame(kind, validate);
      if (data) {
        // This commit still holds the fresh board; save after the restore renders.
        skipStaleSave.current = true;
        onRestoreRef.current(data);
      }
    } else {
      clearTabGame(kind);
    }
    ready.current = true;
    return () => {
      ready.current = false;
      // Leaving the page inside the app ends the game; a reload does not
      // unmount. Deferred so a development StrictMode remount keeps it.
      setTimeout(() => {
        if (!ready.current) clearTabGame(kind);
      }, 0);
    };
  }, [kind, validate]);

  useEffect(() => {
    if (!ready.current || snapshot === null) return;
    if (skipStaleSave.current) {
      skipStaleSave.current = false;
      return;
    }
    saveTabGame(kind, snapshot);
  }, [kind, snapshot]);
}
