import { useCallback, useSyncExternalStore } from "react";
import { safeLocalStorage } from "./safeLocalStorage";

const STORAGE_KEY = "tiao:soundEnabled";

function getSnapshot(): boolean {
  const stored = safeLocalStorage.getItem(STORAGE_KEY);
  return stored === null ? true : stored === "1";
}

function getServerSnapshot(): boolean {
  return true;
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

export function useSoundEnabled(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useToggleSound(): [boolean, () => void] {
  const enabled = useSoundEnabled();
  const toggle = useCallback(() => {
    const next = !getSnapshot();
    safeLocalStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    emitChange();
  }, []);
  return [enabled, toggle];
}
