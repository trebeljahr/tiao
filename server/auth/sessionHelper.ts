import { IncomingMessage } from "http";
import { Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "./auth";
import GameAccount from "../models/GameAccount";
import { PlayerIdentity, isValidUsername } from "../../shared/src";
import { ADMIN_PLAYER_IDS } from "../config/envVars";

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
  return {
    playerId: user.id,
    displayName,
    kind: "account",
    email: user.email,
    profilePicture: account?.profilePicture || user.image || undefined,
    hasSeenTutorial: account?.hasSeenTutorial ?? false,
    badges: account?.badges ?? [],
    activeBadges: account?.activeBadges ?? [],
    ...(ADMIN_PLAYER_IDS.has(user.id) ? { isAdmin: true } : {}),
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
 * (their player ID appears in the ADMIN_PLAYER_IDS env var).
 */
export async function requireAdmin(req: Request, res: Response) {
  const account = await requireAccount(req, res);
  if (!account) return null;

  if (!ADMIN_PLAYER_IDS.has(account.id)) {
    res.status(403).json({
      code: "ADMIN_REQUIRED",
      message: "Admin access is required.",
    });
    return null;
  }

  return account;
}
