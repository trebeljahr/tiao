/**
 * Steam stat definitions.
 *
 * Steam shows a progress bar on an achievement ("37 / 100 games") only when
 * the achievement is linked to a *stat* in the Partner Portal and the game
 * pushes that stat's value via the Steamworks API. Unlocking alone never
 * moves a bar — `unlockAchievement` and stats are separate mechanisms.
 *
 * ## Why fewer stats than achievements
 *
 * Ten achievements have thresholds, but they measure only four quantities,
 * and three of those are plain counters. `ACH_GETTING_STARTED` (5 games),
 * `ACH_REGULAR` (10), `ACH_CENTURION` (100) and `ACH_VETERAN` (1000) are all
 * the same number viewed at different scales, so they share one stat with
 * different `max` values on the Steam side. One stat per achievement would
 * mean four counters that must never disagree.
 *
 * ## The one that isn't here
 *
 * `chain-reaction` ("capture 5+ in a single chain jump") is deliberately
 * unlinked. It is a high-water mark, not an accumulation — the server grants
 * it from a single game event and stores no "best chain" anywhere. Backing it
 * would mean new persisted state, and a progress bar reading "best 3 of 5" is
 * a poor fit for a do-it-once achievement anyway.
 *
 * ## Source of truth
 *
 * The server owns these numbers; the desktop client mirrors them to Steam.
 * `source` names the field on the server's progress payload
 * (`GET /achievements/progress`), which keeps the mapping in one place
 * instead of spread across the sync hook.
 */

/** Keys on the server's progress payload that can back a Steam stat. */
export type AchievementProgressSource = "gamesPlayed" | "gamesLost" | "friendCount";

/** Shape returned by `GET /achievements/progress`. */
export type AchievementProgress = Record<AchievementProgressSource, number>;

export type SteamStatDefinition = {
  /**
   * Steam stat API name. Must match the Partner Portal exactly — like
   * achievement API names, Steam silently ignores writes to stats it does
   * not recognise.
   */
  apiName: string;
  /** Display name entered in the portal. Not shown to players in-game. */
  displayName: string;
  /** Which field of the server's progress payload feeds this stat. */
  source: AchievementProgressSource;
};

export const STEAM_STATS: SteamStatDefinition[] = [
  {
    apiName: "STAT_GAMES_PLAYED",
    displayName: "Games played",
    source: "gamesPlayed",
  },
  {
    apiName: "STAT_GAMES_LOST",
    displayName: "Games lost",
    source: "gamesLost",
  },
  {
    apiName: "STAT_FRIENDS",
    displayName: "Friends added",
    source: "friendCount",
  },
];

export const STEAM_STAT_API_NAMES = STEAM_STATS.map((s) => s.apiName);

export function getSteamStat(apiName: string): SteamStatDefinition | undefined {
  return STEAM_STATS.find((s) => s.apiName === apiName);
}
