"use client";

import { STEAM_STATS } from "@shared";
import { useEffect, useRef } from "react";
import { getAchievementProgress } from "./api";
import { setSteamStats } from "./SteamBridge";

/**
 * Mirror the server's progress counts into Steam stats.
 *
 * Steam draws a progress bar on a partly-completed achievement ("37 / 100
 * games") only when the achievement is linked to a stat in the Partner Portal
 * *and* the game pushes that stat's value. This hook is the pushing half.
 *
 * It is deliberately separate from `useSteamAchievementSync`, which mirrors
 * unlocks. The two answer different questions — "has the player earned this?"
 * versus "how far along are they?" — and Steam keeps them in separate
 * mechanisms. An unlocked achievement with no stat pushed still shows as
 * unlocked; it just shows no bar behind it.
 *
 * Runs once per mount rather than on an interval or per render:
 * `/achievements/progress` recomputes the loss count by scanning finished
 * games, and Steam rate-limits the `store()` that persists stat writes. The
 * achievements screen is the natural moment — it's where a player looks at
 * progress, and it's also when the overlay is most likely to be opened next.
 *
 * Safe to call from any build. Outside the Steam desktop app the bridge is
 * absent and `setSteamStats` short-circuits before any IPC, so the fetch is
 * skipped too.
 */
export function useSteamStatsSync(enabled: boolean): void {
  // One push per mount. Without this, a parent re-render with a changed
  // `enabled` identity would re-run the effect and spend another scan.
  const pushed = useRef(false);

  useEffect(() => {
    if (!enabled || pushed.current) return;
    pushed.current = true;

    let cancelled = false;

    void (async () => {
      let progress: Awaited<ReturnType<typeof getAchievementProgress>>;
      try {
        progress = await getAchievementProgress();
      } catch {
        // Server-side progress is a nicety, not load-bearing: the unlock
        // itself already synced. Failing quietly beats surfacing an error
        // for a cosmetic bar.
        return;
      }
      if (cancelled) return;

      const stats: Record<string, number> = {};
      for (const stat of STEAM_STATS) {
        const value = progress[stat.source];
        if (typeof value === "number" && Number.isFinite(value)) {
          stats[stat.apiName] = value;
        }
      }

      await setSteamStats(stats);
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);
}
