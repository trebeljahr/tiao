"use client";

import { useEffect } from "react";
import { safeLocalStorage } from "@/lib/safeLocalStorage";
import { UI_CLICK_KEY } from "@/lib/uiClickAudio";
import { useSoundEnabled } from "@/lib/useSoundPreference";

/** A sound is opt-in through the audition lab; board moves keep their own audio. */
export function UiClickFeedback() {
  const enabled = useSoundEnabled();
  useEffect(() => {
    if (!enabled) {
      void import("@/lib/uiClickAudio").then((audio) => audio.stopUiClicks());
      return;
    }
    const handleClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const control = target?.closest(
        "button, a[href], [role='button'], input[type='checkbox'], input[type='radio']",
      );
      if (
        !control ||
        control.closest("[data-ui-sound='off'], [data-testid='tiao-board'], [role='grid']") ||
        control.matches(":disabled, [aria-disabled='true']")
      )
        return;
      const id = safeLocalStorage.getItem(UI_CLICK_KEY);
      if (id) void import("@/lib/uiClickAudio").then((audio) => audio.playUiClick(id));
    };
    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [enabled]);
  return null;
}
