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
 * Resolves the badge to display for a given player.
 *
 * For other players: uses `player.activeBadge` from the server.
 * For known preview users: falls back to hardcoded defaults.
 * Returns the badge ID string or undefined if no badge.
 */
export function resolvePlayerBadge(
  player: { displayName?: string; activeBadge?: string } | null | undefined,
): string | undefined {
  if (!player) return undefined;

  // If the server already sent an activeBadge, use it
  if (player.activeBadge && BADGE_DEFINITIONS[player.activeBadge as BadgeId]) {
    return player.activeBadge;
  }

  // Hardcoded fallback for preview users (until server sends badges)
  const name = (player.displayName ?? "").replace(/^@/, "").toLowerCase();
  if (name === "ricotrebeljahr") return "creator";
  if (PREVIEW_USERNAMES.has(name)) return "creator";

  return undefined;
}
