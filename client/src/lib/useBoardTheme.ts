import { useCallback, useContext, useSyncExternalStore } from "react";
import { type BoardTheme, DEFAULT_THEME_ID, getTheme } from "@/components/game/boardThemes";
import { safeLocalStorage } from "@/lib/safeLocalStorage";
import { UnlockedBoardThemesContext } from "./UnlockedBoardThemesContext";

const STORAGE_KEY = "tiao:boardTheme";

// ---------------------------------------------------------------------------
// External store (same pattern as useSoundPreference)
// ---------------------------------------------------------------------------

function getSnapshot(): string {
  return safeLocalStorage.getItem(STORAGE_KEY) ?? DEFAULT_THEME_ID;
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

function canUseTheme(id: string, unlockedThemes: readonly string[] | undefined): boolean {
  return id === DEFAULT_THEME_ID || (getTheme(id).id === id && !!unlockedThemes?.includes(id));
}

/** Returns the active theme ID string (for selectors / persistence). */
export function useBoardThemeId(): string {
  const unlockedThemes = useContext(UnlockedBoardThemesContext);
  const storedId = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // A saved browser preference can outlive its owner's session. Keep it for
  // that account, but never apply it to guests or accounts that do not own it.
  return canUseTheme(storedId, unlockedThemes) ? storedId : DEFAULT_THEME_ID;
}

/** Returns the full resolved BoardTheme object. */
export function useBoardTheme(): BoardTheme {
  const id = useBoardThemeId();
  return getTheme(id);
}

/** Returns [themeId, setThemeId] — the setter persists to localStorage. */
export function useSetBoardTheme(): [string, (id: string) => void] {
  const themeId = useBoardThemeId();
  const unlockedThemes = useContext(UnlockedBoardThemesContext);

  const setTheme = useCallback(
    (id: string) => {
      if (!canUseTheme(id, unlockedThemes)) return;
      safeLocalStorage.setItem(STORAGE_KEY, id);
      emitChange();
    },
    [unlockedThemes],
  );

  return [themeId, setTheme];
}

/** Clear the board theme from localStorage and notify subscribers. */
export function resetBoardTheme(): void {
  safeLocalStorage.removeItem(STORAGE_KEY);
  emitChange();
}
