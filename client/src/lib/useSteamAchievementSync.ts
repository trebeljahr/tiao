"use client";

import { ACHIEVEMENTS } from "@shared";
import { useEffect, useRef } from "react";
import { unlockSteamAchievement } from "./SteamBridge";

/**
 * One-way reconcile: server is the source of truth for achievement
 * state, so every id the server reports as unlocked is pushed to
 * Steam. Steam treats repeated unlocks of the same id as no-ops, so
 * we don't have to track which ones Steam already knows about across
 * sessions — but we DO keep a per-mount Set so the same id doesn't
 * round-trip through IPC repeatedly while the player browses the
 * page or the websocket fires multiple `achievement-changed`
 * messages.
 *
 * In a non-Steam build (web, mobile, plain desktop without
 * STEAM_BUILD=true) `unlockSteamAchievement` short-circuits to a
 * Promise<false> and never reaches IPC — so this hook stays safe to
 * call unconditionally from any page that knows the unlocked-id set.
 *
 * The id ↔ Steam API name mapping follows `AchievementDefinition.steamKey`
 * (falls back to `id`), matching the convention documented in
 * `shared/src/achievements.ts`.
 */
export function useSteamAchievementSync(unlockedIds: readonly string[]): void {
  // Cache of ids already handed to the bridge during this mount.
  // Doesn't need to survive remount — Steam itself is the persistent
  // store, the cache here only suppresses redundant IPC.
  const pushed = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (unlockedIds.length === 0) return;

    let cancelled = false;
    (async () => {
      for (const id of unlockedIds) {
        if (cancelled) return;
        if (pushed.current.has(id)) continue;
        const def = ACHIEVEMENTS.find((a) => a.id === id);
        const apiName = def?.steamKey ?? id;
        // Mark BEFORE the await: even a failed push shouldn't be
        // retried on the next render of the same id — the renderer
        // can't repair a Steam SDK failure from this side.
        pushed.current.add(id);
        await unlockSteamAchievement(apiName);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [unlockedIds]);
}
