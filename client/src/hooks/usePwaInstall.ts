"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Minimal shape of the non-standard `beforeinstallprompt` event. Chrome/Edge
 * fire this on installable PWAs; Safari does not (iOS requires Share → "Add to
 * Home Screen" manually).
 */
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

const DISMISS_STORAGE_KEY = "tiao:pwa-install-dismissed";
const DISMISS_COOLDOWN_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  // iOS Safari sets this non-standard property when launched from Home Screen.
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

function readDismissedAt(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DISMISS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isDismissCooldownActive(now: number = Date.now()): boolean {
  const dismissedAt = readDismissedAt();
  if (dismissedAt === null) return false;
  return now - dismissedAt < DISMISS_COOLDOWN_MS;
}

export interface UsePwaInstallResult {
  /** True when `beforeinstallprompt` has fired and the user hasn't dismissed or installed. */
  canPrompt: boolean;
  /** True when the app is already running in standalone / installed mode. */
  isStandalone: boolean;
  /** Triggers the native browser install prompt. Resolves to the user's choice. */
  promptInstall: () => Promise<"accepted" | "dismissed" | "unavailable">;
  /** Hides the banner and records a 14-day cooldown in localStorage. */
  dismiss: () => void;
}

/**
 * Tracks PWA install eligibility. Listens for `beforeinstallprompt` on mount,
 * exposes a stable `promptInstall()` that the UI can call on user click, and
 * persists dismissal so the banner doesn't nag after the user declines.
 */
export function usePwaInstall(): UsePwaInstallResult {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState<boolean>(false);
  const [dismissed, setDismissed] = useState<boolean>(false);

  useEffect(() => {
    setIsStandalone(isStandaloneDisplay());
    setDismissed(isDismissCooldownActive());

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredEvent(event as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setDeferredEvent(null);
      setIsStandalone(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<"accepted" | "dismissed" | "unavailable"> => {
    if (!deferredEvent) return "unavailable";
    try {
      await deferredEvent.prompt();
      const choice = await deferredEvent.userChoice;
      setDeferredEvent(null);
      if (choice.outcome === "dismissed") {
        try {
          window.localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now()));
        } catch {
          // ignore storage errors (private mode, disabled storage)
        }
        setDismissed(true);
      }
      return choice.outcome;
    } catch {
      return "unavailable";
    }
  }, [deferredEvent]);

  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now()));
    } catch {
      // ignore
    }
    setDismissed(true);
  }, []);

  const canPrompt = deferredEvent !== null && !isStandalone && !dismissed;

  return { canPrompt, isStandalone, promptInstall, dismiss };
}
