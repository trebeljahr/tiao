"use client";

import { useEffect, useRef } from "react";
import { toast, useSonner } from "sonner";
import { playUiFeedback } from "@/lib/uiClickAudio";
import { useSoundEnabled } from "@/lib/useSoundPreference";

/** Delegate UI controls; board moves retain their dedicated placement audio. */
export function UiClickFeedback() {
  const enabled = useSoundEnabled();
  const { toasts } = useSonner();
  const seenToasts = useRef<Map<string | number, string> | null>(null);
  if (seenToasts.current === null) {
    // Sonner replays active history asynchronously when a subscriber mounts.
    seenToasts.current = new Map(
      toast
        .getToasts()
        .map((item) => [item.id, "type" in item ? (item.type ?? "default") : "dismissed"]),
    );
  }
  useEffect(() => {
    const seen = seenToasts.current!;
    const outcome = toasts.find(
      (item) =>
        (item.type === "success" || item.type === "error") && seen.get(item.id) !== item.type,
    );
    for (const item of toasts) seen.set(item.id, item.type ?? "default");
    // Track muted updates too, so unmuting never replays old notifications.
    if (enabled && (outcome?.type === "success" || outcome?.type === "error"))
      void playUiFeedback(outcome.type);
  }, [toasts, enabled]);
  useEffect(() => {
    if (!enabled) {
      void import("@/lib/uiClickAudio").then((audio) => audio.stopUiClicks());
      return;
    }
    const handleClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const control = target?.closest(
        "button, a[href], [role='button'], input[type='checkbox'], input[type='radio'], input[type='submit'], input[type='button'], [role='tab'], [role='switch'], [role='checkbox'], [role='radio'], [role='menuitem'], select, summary",
      );
      if (
        !control ||
        control.closest("[data-ui-sound='off'], [data-testid='tiao-board'], [role='grid']") ||
        control.matches(":disabled, [aria-disabled='true']")
      )
        return;
      const feedback = control.closest("[data-ui-feedback]")?.getAttribute("data-ui-feedback");
      if (feedback === "manual") return;
      if (feedback === "success" || feedback === "error") {
        void playUiFeedback(feedback);
        return;
      }
      void playUiFeedback("click");
    };
    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [enabled]);
  return null;
}
