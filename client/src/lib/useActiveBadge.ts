import { useSyncExternalStore, useCallback } from "react";
import type { BadgeId } from "@/components/UserBadge";

const STORAGE_KEY = "tiao:activeBadge";

// ---------------------------------------------------------------------------
// External store (same pattern as useSoundPreference / useBoardTheme)
// ---------------------------------------------------------------------------

/** Returns the stored active badge ID, or null if badges are hidden. */
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

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Returns the active badge ID (what the user chose to display), or null. */
export function useActiveBadgeId(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Returns [activeBadgeId, setActiveBadge].
 * - Pass a BadgeId to select that badge.
 * - Pass null to hide all badges.
 */
export function useSetActiveBadge(): [string | null, (id: BadgeId | null) => void] {
  const activeBadgeId = useActiveBadgeId();

  const setActiveBadge = useCallback((id: BadgeId | null) => {
    if (id === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, id);
    }
    emitChange();
  }, []);

  return [activeBadgeId, setActiveBadge];
}
