/**
 * Achievement definitions for Tiao.
 *
 * This is a pure data file with no runtime dependencies — the same IDs can be
 * mapped 1:1 to Steamworks achievement API names later.
 */

export type AchievementTier = "bronze" | "silver" | "gold" | "platinum";

export type AchievementCategory =
  | "games"
  | "combat"
  | "speed"
  | "social"
  | "ranking"
  | "tournament"
  | "learning"
  | "secret";

export type AchievementDefinition = {
  id: string;
  /**
   * Steamworks achievement API name. Required, and must match the API
   * name configured for this achievement in the Steam Partner Portal
   * exactly — Steam silently ignores unlock calls for names it doesn't
   * know, so a typo here fails without any error at runtime.
   *
   * Kept separate from `id` rather than derived from it: `id` is the
   * server-side identifier persisted in the database, while this is an
   * external contract with Valve. Deriving one from the other would
   * mean a database rename silently breaks live achievements.
   *
   * Convention: `ACH_` + the id in upper snake case.
   */
  steamKey: string;
  name: string;
  description: string;
  category: AchievementCategory;
  tier: AchievementTier;
  /** If true, name/description are hidden until unlocked. */
  secret: boolean;
  /** For progressive achievements — the target count. */
  threshold?: number;
  /**
   * Steam stat backing this achievement's progress bar, if any.
   *
   * Only meaningful alongside `threshold`: the pair becomes the stat plus
   * the `max` configured against it in the Partner Portal. Several
   * achievements intentionally share one stat at different thresholds — see
   * `steamStats.ts`. Achievements granted from a single event rather than an
   * accumulating count leave this unset.
   */
  progressStat?: string;
  /** Sort order within category. */
  order: number;
};

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

export const ACHIEVEMENTS: AchievementDefinition[] = [
  // ── Games Played ──────────────────────────────────────────────────────
  {
    id: "first-move",
    steamKey: "ACH_FIRST_MOVE",
    name: "First Move",
    description: "Make your first move in a multiplayer game.",
    category: "games",
    tier: "bronze",
    secret: false,
    order: 0,
  },
  {
    id: "getting-started",
    steamKey: "ACH_GETTING_STARTED",
    name: "Getting the Hang of It",
    description: "Play 5 games.",
    category: "games",
    tier: "bronze",
    secret: false,
    threshold: 5,
    progressStat: "STAT_GAMES_PLAYED",
    order: 1,
  },
  {
    id: "regular",
    steamKey: "ACH_REGULAR",
    name: "Table Regular",
    description: "Play 10 games.",
    category: "games",
    tier: "silver",
    secret: false,
    threshold: 10,
    progressStat: "STAT_GAMES_PLAYED",
    order: 2,
  },
  {
    id: "centurion",
    steamKey: "ACH_CENTURION",
    name: "Centurion",
    description: "Play 100 games.",
    category: "games",
    tier: "gold",
    secret: false,
    threshold: 100,
    progressStat: "STAT_GAMES_PLAYED",
    order: 3,
  },
  {
    id: "veteran",
    steamKey: "ACH_VETERAN",
    name: "Grizzled Veteran",
    description: "Play 1,000 games.",
    category: "games",
    tier: "platinum",
    secret: false,
    threshold: 1000,
    progressStat: "STAT_GAMES_PLAYED",
    order: 4,
  },

  // ── Losses ────────────────────────────────────────────────────────────
  {
    id: "first-fall",
    steamKey: "ACH_FIRST_FALL",
    name: "Everybody Falls",
    description: "Lose your first game.",
    category: "combat",
    tier: "bronze",
    secret: false,
    threshold: 1,
    progressStat: "STAT_GAMES_LOST",
    order: 10,
  },
  {
    id: "tough-luck",
    steamKey: "ACH_TOUGH_LUCK",
    name: "Tough Luck",
    description: "Lose 5 games.",
    category: "combat",
    tier: "silver",
    secret: false,
    threshold: 5,
    progressStat: "STAT_GAMES_LOST",
    order: 11,
  },
  {
    id: "punching-bag",
    steamKey: "ACH_PUNCHING_BAG",
    name: "Human Punching Bag",
    description: "Lose 10 games.",
    category: "combat",
    tier: "gold",
    secret: false,
    threshold: 10,
    progressStat: "STAT_GAMES_LOST",
    order: 12,
  },

  // ── Timed Wins ────────────────────────────────────────────────────────
  {
    id: "speed-demon",
    steamKey: "ACH_SPEED_DEMON",
    name: "Speed Demon",
    description: "Win a timed game.",
    category: "speed",
    tier: "bronze",
    secret: false,
    order: 20,
  },
  {
    id: "buzzer-beater",
    steamKey: "ACH_BUZZER_BEATER",
    name: "Buzzer Beater",
    description: "Win a timed game with less than 10 seconds on your clock.",
    category: "speed",
    tier: "gold",
    secret: false,
    order: 21,
  },
  {
    id: "one-second-glory",
    steamKey: "ACH_ONE_SECOND_GLORY",
    name: "Living on the Edge",
    description: "Win a timed game with 1 second or less on your clock.",
    category: "speed",
    tier: "platinum",
    secret: false,
    order: 22,
  },

  // ── AI Opponents ──────────────────────────────────────────────────────
  {
    id: "ai-easy",
    steamKey: "ACH_AI_EASY",
    name: "Baby Steps",
    description: "Beat an Easy AI.",
    category: "combat",
    tier: "bronze",
    secret: false,
    order: 30,
  },
  {
    id: "ai-medium",
    steamKey: "ACH_AI_MEDIUM",
    name: "Holding My Own",
    description: "Beat a Medium AI.",
    category: "combat",
    tier: "silver",
    secret: false,
    order: 31,
  },
  {
    id: "ai-hard",
    steamKey: "ACH_AI_HARD",
    name: "Skynet Who?",
    description: "Beat a Hard AI.",
    category: "combat",
    tier: "gold",
    secret: false,
    order: 32,
  },

  // ── Social ────────────────────────────────────────────────────────────
  {
    id: "first-friend",
    steamKey: "ACH_FIRST_FRIEND",
    name: "New Kid on the Block",
    description: "Make your first friend.",
    category: "social",
    tier: "bronze",
    secret: false,
    threshold: 1,
    progressStat: "STAT_FRIENDS",
    order: 40,
  },
  {
    id: "social-butterfly",
    steamKey: "ACH_SOCIAL_BUTTERFLY",
    name: "Social Butterfly",
    description: "Make 10 friends.",
    category: "social",
    tier: "gold",
    secret: false,
    threshold: 10,
    progressStat: "STAT_FRIENDS",
    order: 41,
  },

  // ── Ranking ───────────────────────────────────────────────────────────
  {
    id: "top-one-percent",
    steamKey: "ACH_TOP_ONE_PERCENT",
    name: "The One Percent",
    description: "Reach the top 1% of players.",
    category: "ranking",
    tier: "platinum",
    secret: false,
    order: 50,
  },

  // ── Tournament ────────────────────────────────────────────────────────
  {
    id: "tournament-champion",
    steamKey: "ACH_TOURNAMENT_CHAMPION",
    name: "Tournament Champion",
    description: "Win a tournament.",
    category: "tournament",
    tier: "gold",
    secret: false,
    order: 60,
  },

  // ── Learning ──────────────────────────────────────────────────────────
  {
    id: "tutorial-complete",
    steamKey: "ACH_TUTORIAL_COMPLETE",
    name: "Star Student",
    description: "Complete the tutorial.",
    category: "learning",
    tier: "bronze",
    secret: false,
    order: 70,
  },

  // ── Spectating ────────────────────────────────────────────────────────
  {
    id: "spectator",
    steamKey: "ACH_SPECTATOR",
    name: "Armchair General",
    description: "Spectate a game.",
    category: "social",
    tier: "bronze",
    secret: false,
    order: 80,
  },

  // ── Captures ───────────────────────────────────────────────────────────
  {
    id: "first-blood",
    steamKey: "ACH_FIRST_BLOOD",
    name: "First Blood",
    description: "Capture your first piece.",
    category: "combat",
    tier: "bronze",
    secret: false,
    order: 33,
  },
  {
    id: "chain-reaction",
    steamKey: "ACH_CHAIN_REACTION",
    name: "Chain Reaction",
    description: "Capture 5 or more pieces in a single chain jump.",
    category: "combat",
    tier: "gold",
    secret: false,
    threshold: 5,
    order: 34,
  },
  {
    id: "one-jump-wonder",
    steamKey: "ACH_ONE_JUMP_WONDER",
    name: "One Jump Wonder",
    description: "Win an entire game from a single chain jump.",
    category: "combat",
    tier: "platinum",
    secret: false,
    order: 35,
  },

  // ── Secret Achievements ───────────────────────────────────────────────
  {
    id: "rage-quit",
    steamKey: "ACH_RAGE_QUIT",
    name: "Rage Quit",
    description: "Forfeit a game within the first 3 moves.",
    category: "secret",
    tier: "bronze",
    secret: true,
    order: 100,
  },
  {
    id: "night-owl",
    steamKey: "ACH_NIGHT_OWL",
    name: "Night Owl",
    description: "Play a game between 2 AM and 5 AM.",
    category: "secret",
    tier: "silver",
    secret: true,
    order: 101,
  },
  {
    id: "speedrun",
    steamKey: "ACH_SPEEDRUN",
    name: "Speedrun Any%",
    description: "Win a game in under 30 seconds.",
    category: "secret",
    tier: "gold",
    secret: true,
    order: 102,
  },
  {
    id: "comeback-kid",
    steamKey: "ACH_COMEBACK_KID",
    name: "Comeback Kid",
    description: "Win after being down by 3 or more points.",
    category: "secret",
    tier: "gold",
    secret: true,
    order: 103,
  },
  {
    id: "flawless-victory",
    steamKey: "ACH_FLAWLESS_VICTORY",
    name: "Flawless Victory",
    description: "Win a game without losing a single piece to capture.",
    category: "secret",
    tier: "platinum",
    secret: true,
    order: 104,
  },
  {
    id: "david-vs-goliath",
    steamKey: "ACH_DAVID_VS_GOLIATH",
    name: "David vs. Goliath",
    description: "Beat a player rated 300+ points above you.",
    category: "secret",
    tier: "gold",
    secret: true,
    order: 105,
  },
  {
    id: "checkered-past",
    steamKey: "ACH_CHECKERED_PAST",
    name: "Checkered Past",
    description: "Play on every board size.",
    category: "secret",
    tier: "silver",
    secret: true,
    order: 106,
  },
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

const _byId = new Map<string, AchievementDefinition>();
for (const a of ACHIEVEMENTS) _byId.set(a.id, a);

export function getAchievementById(id: string): AchievementDefinition | undefined {
  return _byId.get(id);
}

export const ACHIEVEMENT_IDS = ACHIEVEMENTS.map((a) => a.id);

/** Achievement categories in display order. */
export const ACHIEVEMENT_CATEGORIES: { key: AchievementCategory; label: string }[] = [
  { key: "games", label: "Games" },
  { key: "combat", label: "Combat" },
  { key: "speed", label: "Speed" },
  { key: "social", label: "Social" },
  { key: "ranking", label: "Ranking" },
  { key: "tournament", label: "Tournament" },
  { key: "learning", label: "Learning" },
  { key: "secret", label: "Secret" },
];
