import { useSyncExternalStore, useCallback } from "react";
import { type BoardTheme, DEFAULT_THEME_ID, getTheme } from "@/components/game/boardThemes";

const STORAGE_KEY = "tiao:boardTheme";

// ---------------------------------------------------------------------------
// External store (same pattern as useSoundPreference)
// ---------------------------------------------------------------------------

function getSnapshot(): string {
  return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_THEME_ID;
}

function getServerSnapshot(): string {
  return DEFAULT_THEME_ID;
}

let listeners: Array<() => void> = [];

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Returns the active theme ID string (for selectors / persistence). */
export function useBoardThemeId(): string {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Returns the full resolved BoardTheme object. */
export function useBoardTheme(): BoardTheme {
  const id = useBoardThemeId();
  return getTheme(id);
}

/** Returns [themeId, setThemeId] — the setter persists to localStorage. */
export function useSetBoardTheme(): [string, (id: string) => void] {
  const themeId = useBoardThemeId();

  const setTheme = useCallback((id: string) => {
    localStorage.setItem(STORAGE_KEY, id);
    emitChange();
  }, []);

  return [themeId, setTheme];
}

/** Clear the board theme from localStorage and notify subscribers. */
export function resetBoardTheme(): void {
  localStorage.removeItem(STORAGE_KEY);
  emitChange();
}
