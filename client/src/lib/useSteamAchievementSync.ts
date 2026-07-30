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
 * The id ↔ Steam API name mapping comes from
 * `AchievementDefinition.steamKey` in `shared/src/achievements.ts`.
 * Ids the local definitions don't know about are skipped rather than
 * passed through: a server running ahead of this bundle can report an
 * achievement that isn't in ACHIEVEMENTS yet, and its raw kebab-case
 * id is never a valid Steam API name, so sending it would be a
 * guaranteed silent no-op on Steam's side.
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
        // Mark BEFORE the await: even a failed push shouldn't be
        // retried on the next render of the same id — the renderer
        // can't repair a Steam SDK failure from this side.
        pushed.current.add(id);
        if (!def) continue;
        await unlockSteamAchievement(def.steamKey);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [unlockedIds]);
}
