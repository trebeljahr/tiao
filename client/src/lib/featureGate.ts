import type { AuthResponse } from "@shared";
import { type BadgeId, ALL_BADGE_IDS, BADGE_DEFINITIONS } from "@/components/UserBadge";

/**
 * Usernames that have access to premium/preview features before they're
 * publicly available behind a paywall.
 *
 * TODO: Remove this once better-auth + Stripe are integrated and features
 * are gated by purchase entitlements instead.
 */
const PREVIEW_USERNAMES = new Set([
  "ricotrebeljahr",
  "andreas edmeier",
  "andreas-edmeier",
  "andreasedmeier",
]);

function normalizeUsername(auth: AuthResponse): string {
  return auth.player.displayName.replace(/^@/, "").toLowerCase();
}

/** Returns true if the current user has access to preview features (board themes, etc.). */
export function hasPreviewAccess(auth: AuthResponse | null): boolean {
  if (!auth || auth.player.kind !== "account") return false;
  return PREVIEW_USERNAMES.has(normalizeUsername(auth));
}

/** Returns true if the user is an admin who can preview all badges/features. */
export function isAdmin(auth: AuthResponse | null): boolean {
  if (!auth || auth.player.kind !== "account") return false;
  return normalizeUsername(auth) === "ricotrebeljahr";
}

/**
 * Returns the badges a player has earned.
 *
 * Hardcoded for now — will be replaced by server-side badge data once
 * better-auth + Stripe are integrated.
 */
export function getBadgesForPlayer(auth: AuthResponse | null): BadgeId[] {
  if (!auth || auth.player.kind !== "account") return [];
  const name = normalizeUsername(auth);

  // Rico gets all badges for testing/previewing
  if (name === "ricotrebeljahr") {
    return [...ALL_BADGE_IDS];
  }

  if (PREVIEW_USERNAMES.has(name)) {
    // Andreas (any username variant)
    return ["creator", "contributor"];
  }

  return [];
}

/**
 * Resolves the badge(s) to display for a given player.
 *
 * For other players: uses `player.activeBadges` from the server.
 * For known preview users: falls back to hardcoded defaults.
 * Returns an array of badge ID strings (empty = no badges).
 */
export function resolvePlayerBadges(
  player: { displayName?: string; activeBadges?: string[] } | null | undefined,
): string[] {
  if (!player) return [];

  // If the server already sent activeBadges, use them
  if (player.activeBadges && player.activeBadges.length > 0) {
    return player.activeBadges.filter((id) => BADGE_DEFINITIONS[id as BadgeId]);
  }

  // Hardcoded fallback for preview users (until server sends badges)
  const name = (player.displayName ?? "").replace(/^@/, "").toLowerCase();
  if (name === "ricotrebeljahr") return ["creator"];
  if (PREVIEW_USERNAMES.has(name)) return ["creator"];

  return [];
}
