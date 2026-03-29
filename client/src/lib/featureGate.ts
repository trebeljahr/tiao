import type { AuthResponse } from "@shared";
import { type BadgeId, BADGE_DEFINITIONS } from "@/components/UserBadge";

/**
 * Returns true if the current user has access to preview features (board themes, etc.).
 *
 * Preview access is granted when the player has at least one unlocked badge,
 * meaning they have been explicitly granted access in the database.
 */
export function hasPreviewAccess(auth: AuthResponse | null): boolean {
  if (!auth || auth.player.kind !== "account") return false;
  return (auth.player.badges ?? []).length > 0;
}

/**
 * Returns true if the user is an admin.
 *
 * Admin status is indicated by the `isAdmin` flag in the auth response,
 * which is set server-side based on the ADMIN_PLAYER_IDS env var.
 */
export function isAdmin(auth: AuthResponse | null): boolean {
  if (!auth || auth.player.kind !== "account") return false;
  return auth.player.isAdmin === true;
}

/**
 * Resolves the badge(s) to display for a given player.
 *
 * Uses `player.activeBadges` from the server (populated from DB).
 * Returns an array of valid badge ID strings (empty = no badges).
 */
export function resolvePlayerBadges(
  player: { activeBadges?: string[] } | null | undefined,
): string[] {
  if (!player) return [];

  // If the server sent activeBadges (even empty = user chose "hidden"), use them.
  // Only fall back when activeBadges is undefined/null (no data from server).
  if (player.activeBadges != null) {
    return player.activeBadges.filter((id) => BADGE_DEFINITIONS[id as BadgeId]);
  }

  return [];
}
