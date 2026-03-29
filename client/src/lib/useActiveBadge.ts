import { useSyncExternalStore, useCallback } from "react";
import type { BadgeId } from "@/components/UserBadge";

const STORAGE_KEY = "tiao:activeBadges";

// ---------------------------------------------------------------------------
// External store (same pattern as useSoundPreference / useBoardTheme)
// ---------------------------------------------------------------------------

/** Returns the stored active badge IDs as a JSON array string, or null. */
function getSnapshot(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

function getServerSnapshot(): string | null {
  return null;
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

function parseStoredBadges(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Legacy: single badge ID string (from before multi-badge support)
    return raw ? [raw] : [];
  }
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Returns the first active badge ID from localStorage, or null.
 * Used by PlayerIdentityRow for quick single-badge display.
 */
export function useActiveBadgeId(): string | null {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const badges = parseStoredBadges(raw);
  return badges[0] ?? null;
}

/** Returns all active badge IDs from localStorage. */
export function useActiveBadges(): string[] {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return parseStoredBadges(raw);
}

/**
 * Returns [activeBadges, setActiveBadges].
 * - Pass an array of BadgeIds to select those badges.
 * - Pass an empty array to hide all badges.
 */
export function useSetActiveBadges(): [string[], (ids: BadgeId[]) => void] {
  const activeBadges = useActiveBadges();

  const setActiveBadges = useCallback((ids: BadgeId[]) => {
    if (ids.length === 0) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    }
    emitChange();
  }, []);

  return [activeBadges, setActiveBadges];
}

/** Clear all active badges from localStorage and notify subscribers. */
export function resetActiveBadges(): void {
  localStorage.removeItem(STORAGE_KEY);
  emitChange();
}
