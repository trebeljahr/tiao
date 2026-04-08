import type { AuthResponse } from "@shared";
import { type BadgeId, BADGE_DEFINITIONS } from "@/components/UserBadge";

/**
 * Returns true if the current user has access to preview features (board themes, etc.).
 *
 * Preview access is granted when the player has at least one unlocked board theme,
 * meaning an admin has explicitly granted theme access in the database.
 */
export function hasPreviewAccess(auth: AuthResponse | null): boolean {
  if (!auth || auth.player.kind !== "account") return false;
  return (auth.player.unlockedThemes ?? []).length > 0;
}

/**
 * Returns true if the user is an admin.
 *
 * Admin status is indicated by the `isAdmin` flag in the auth response,
 * which is set server-side based on the isAdmin field in the database.
 */
export function isAdmin(auth: AuthResponse | null): boolean {
  if (!auth || auth.player.kind !== "account") return false;
  return auth.player.isAdmin === true;
}

/**
 * Returns true if dev-only features (shop, achievements) should be visible.
 * Hidden in production builds, shown in development.
 */
export function isDevFeatureEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

/**
 * Returns true if the shop should be visible to the current user.
 * Visible in development for everyone; in production only to admins
 * (used to playtest shop/Stripe flows without exposing them publicly).
 */
export function canSeeShop(auth: AuthResponse | null): boolean {
  return isDevFeatureEnabled() || isAdmin(auth);
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
