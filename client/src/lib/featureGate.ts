import type { AuthResponse } from "@shared";
import { BADGE_DEFINITIONS, type BadgeId } from "@/components/UserBadge";
import { canPurchaseIn, getStorePurchaseChannel, useStorePurchaseChannel } from "./storePurchases";

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
 * Returns true if development previews should be visible.
 * Hidden in production builds, shown in development.
 */
export function isDevFeatureEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

/**
 * The shop is public in every environment. Steam builds never show
 * Stripe checkout — Valve requires its own payment system — so there the
 * shop appears only once Steam Microtransactions can fulfill purchases
 * (server configured and the desktop bridge present). Render paths that
 * must update when that resolves use `useStorePurchaseChannel()`.
 */
export function canSeeShop(_auth: AuthResponse | null): boolean {
  return canPurchaseIn(getStorePurchaseChannel());
}

/** `canSeeShop` for components that must re-render when store config loads. */
export function useCanSeeShop(_auth: AuthResponse | null): boolean {
  return canPurchaseIn(useStorePurchaseChannel());
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
