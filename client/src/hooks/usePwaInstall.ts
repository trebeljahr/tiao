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

function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  // iOS Safari sets this non-standard property when launched from Home Screen.
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

export interface UsePwaInstallResult {
  /** True when an install prompt is available and the app isn't already standalone. */
  canInstall: boolean;
  /** True when the app is already running in standalone / installed mode. */
  isStandalone: boolean;
  /** Triggers the native browser install prompt. Resolves to the user's choice. */
  promptInstall: () => Promise<"accepted" | "dismissed" | "unavailable">;
}

/**
 * Tracks PWA install eligibility. Listens for `beforeinstallprompt` on mount
 * and exposes a stable `promptInstall()` that the UI calls only when the
 * player asks to install (the nav drawer entry). Nothing prompts on its own.
 */
export function usePwaInstall(): UsePwaInstallResult {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState<boolean>(false);

  useEffect(() => {
    setIsStandalone(isStandaloneDisplay());

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
      return choice.outcome;
    } catch {
      return "unavailable";
    }
  }, [deferredEvent]);

  const canInstall = deferredEvent !== null && !isStandalone;

  return { canInstall, isStandalone, promptInstall };
}
