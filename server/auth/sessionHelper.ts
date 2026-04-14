import { IncomingMessage } from "http";
import { Request, Response } from "express";
import { Types } from "mongoose";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "./auth";
import GameAccount from "../models/GameAccount";
import Achievement from "../models/Achievement";
import { ACHIEVEMENT_BADGE_MAP } from "../config/badgeRewards";
import { PlayerIdentity, isValidUsername } from "../../shared/src";

async function toPlayerIdentity(user: {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  isAnonymous?: boolean | null;
  displayName?: string | null;
}): Promise<PlayerIdentity> {
  if (user.isAnonymous) {
    return {
      playerId: user.id,
      displayName: user.name,
      kind: "guest",
    };
  }

  const account = await GameAccount.findById(user.id);
  const displayName = account?.displayName || user.displayName || user.name;
  const needsUsername = !isValidUsername(displayName);

  // Backfill achievement-earned badges into account.badges so the badge
  // selector shows them. This catches users who unlocked an achievement
  // before the auto-grant logic landed (or any case where the grant call
  // silently failed). Cheap: a single Achievement query per session lookup.
  // Skip when user.id isn't a valid ObjectId (e.g. unit test stubs).
  if (account && Types.ObjectId.isValid(user.id)) {
    const achievementIds = await Achievement.find({ playerId: user.id })
      .select("achievementId")
      .lean();
    const expectedBadges: string[] = [];
    for (const a of achievementIds) {
      const badgeId = ACHIEVEMENT_BADGE_MAP[a.achievementId];
      if (badgeId && !account.badges.includes(badgeId)) {
        expectedBadges.push(badgeId);
      }
    }
    if (expectedBadges.length > 0) {
      try {
        // Use $addToSet to avoid duplicates if another request races us.
        const updated = await GameAccount.findByIdAndUpdate(
          user.id,
          { $addToSet: { badges: { $each: expectedBadges } } },
          { new: true },
        );
        if (updated) {
          account.badges = updated.badges;
        }
      } catch (err) {
        console.error("[sessionHelper] Failed to backfill achievement badges:", err);
      }
    }
  }

  return {
    playerId: user.id,
    displayName,
    kind: "account",
    email: user.email,
    profilePicture: account?.profilePicture || user.image || undefined,
    hasSeenTutorial: account?.hasSeenTutorial ?? false,
    badges: [...new Set<string>(account?.badges ?? [])],
    activeBadges: [...new Set<string>(account?.activeBadges ?? [])],
    unlockedThemes: account?.unlockedThemes ?? [],
    ...(account?.isAdmin ? { isAdmin: true } : {}),
    rating: account?.rating?.overall?.elo,
    ...(needsUsername ? { needsUsername: true } : {}),
  };
}

export async function getPlayerFromRequest(req: Request): Promise<PlayerIdentity | null> {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
  if (!session) return null;
  return toPlayerIdentity(session.user);
}

export async function getPlayerFromUpgradeRequest(
  request: IncomingMessage,
): Promise<PlayerIdentity | null> {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(request.headers),
  });
  if (!session) return null;
  return toPlayerIdentity(session.user);
}

export async function requireAccount(req: Request, res: Response) {
  const player = await getPlayerFromRequest(req);
  if (!player) {
    res.status(401).json({
      code: "NOT_AUTHENTICATED",
      message: "Not authenticated.",
    });
    return null;
  }

  if (player.kind !== "account") {
    res.status(403).json({
      code: "ACCOUNT_REQUIRED",
      message: "Only account players can access this resource.",
    });
    return null;
  }

  const account = await GameAccount.findById(player.playerId);
  if (!account) {
    res.status(404).json({
      code: "ACCOUNT_NOT_FOUND",
      message: "That account could not be found.",
    });
    return null;
  }

  return account;
}

/**
 * Like requireAccount but also checks that the caller is an admin
 * (the account has isAdmin: true in the database).
 */
export async function requireAdmin(req: Request, res: Response) {
  const account = await requireAccount(req, res);
  if (!account) return null;

  if (!account.isAdmin) {
    res.status(403).json({
      code: "ADMIN_REQUIRED",
      message: "Admin access is required.",
    });
    return null;
  }

  return account;
}
