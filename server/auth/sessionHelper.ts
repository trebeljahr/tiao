import type { IncomingMessage } from "node:http";
import { fromNodeHeaders } from "better-auth/node";
import type { Request, Response } from "express";
import { type HydratedDocument, Types } from "mongoose";
import { isValidUsername, type PlayerIdentity } from "../../shared/src";
import { ACHIEVEMENT_BADGE_MAP } from "../config/badgeRewards";
import Achievement from "../models/Achievement";
import GameAccount, { type IGameAccount } from "../models/GameAccount";
import { auth } from "./auth";
import { type BetterAuthUserLike, normalizeAuthUser } from "./betterAuthIds";
import * as betterAuthUserLookup from "./betterAuthUserLookup";
import { extractBearerUserId } from "./desktopSessionManager";

// Track which players have already had their achievement→badge backfill
// checked this process lifetime. Avoids an Achievement.find() query on
// every single authenticated request. Resets on server restart, which is
// fine — the backfill is idempotent and only needed once per player.
const backfilledPlayers = new Set<string>();

// Per-request cache for the GameAccount document, so requireAccount and
// requireAdmin don't repeat the findById that toPlayerIdentity already
// did inside getPlayerFromRequest. Keyed by a symbol on the express
// Request object, scoped to the lifetime of one HTTP request.
const REQUEST_ACCOUNT_KEY = Symbol("tiao.requestAccount");
type RequestWithAccount = Request & {
  [REQUEST_ACCOUNT_KEY]?: HydratedDocument<IGameAccount> | null;
};

function setRequestAccount(req: Request, account: HydratedDocument<IGameAccount> | null): void {
  (req as RequestWithAccount)[REQUEST_ACCOUNT_KEY] = account;
}

function getRequestAccount(req: Request): HydratedDocument<IGameAccount> | null | undefined {
  return (req as RequestWithAccount)[REQUEST_ACCOUNT_KEY];
}

async function toPlayerIdentity(
  rawUser: BetterAuthUserLike,
  req?: Request,
): Promise<PlayerIdentity | null> {
  const user = normalizeAuthUser(rawUser);
  if (!user) return null;

  if (user.isAnonymous) {
    return {
      playerId: user.id,
      displayName: user.name || `guest-${user.id.slice(0, 6)}`,
      kind: "guest",
    };
  }

  const account = await GameAccount.findById(user.id);
  // Stash the account on the request so requireAccount/requireAdmin can
  // reuse it without re-querying.
  if (req) setRequestAccount(req, account);
  const displayName = account?.displayName || user.displayName || user.name;
  const needsUsername = !isValidUsername(displayName);

  // Backfill achievement-earned badges into account.badges so the badge
  // selector shows them. This catches users who unlocked an achievement
  // before the auto-grant logic landed (or any case where the grant call
  // silently failed). Only runs once per player per server process —
  // subsequent requests skip the Achievement query entirely.
  if (account && Types.ObjectId.isValid(user.id) && !backfilledPlayers.has(user.id)) {
    backfilledPlayers.add(user.id);
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
  // 1. Cookie-based session (web + same-origin requests).
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
  if (session) {
    return toPlayerIdentity(session.user, req);
  }

  // 2. Bearer-token fallback for desktop Electron sessions.  When the
  //    request is missing a valid better-auth cookie we check for an
  //    Authorization: Bearer header minted by /api/auth/desktop/exchange.
  //    This path is skipped entirely for web users (who always have a
  //    cookie set by better-auth on the frontend origin).
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const userId = await extractBearerUserId(authHeader);
  if (!userId) return null;

  // Look up the better-auth user record to get name/email/image so the
  // same toPlayerIdentity function can build a PlayerIdentity for either
  // auth path.  `betterAuthUserLookup` is imported as a namespace so
  // tests can monkey-patch it without needing a DB connection.
  const user = await betterAuthUserLookup.lookupBetterAuthUser(userId);
  if (!user) return null;
  return toPlayerIdentity(user, req);
}

export async function getPlayerFromUpgradeRequest(
  request: IncomingMessage,
  options: { bearerUserId?: string | null } = {},
): Promise<PlayerIdentity | null> {
  // 1. Cookie-based session (web clients where the browser upgrade
  //    request carries the better-auth session cookie).
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(request.headers),
  });
  if (session) {
    return toPlayerIdentity(session.user);
  }

  // 2. Bearer-token fallback for desktop Electron clients.
  //    WebSocket upgrade requests from browser APIs cannot set custom
  //    headers, so the desktop renderer puts the bearer token in a
  //    `?token=` query param.  The caller in server/index.ts validates
  //    the token against the revocable session store via
  //    desktopSessionManager.verifySessionToken, and passes the
  //    extracted userId here via `options.bearerUserId` so we don't
  //    re-parse the URL.
  if (options.bearerUserId) {
    const user = await betterAuthUserLookup.lookupBetterAuthUser(options.bearerUserId);
    if (user) return toPlayerIdentity(user);
  }

  return null;
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

  // Reuse the account that toPlayerIdentity already loaded on this request.
  // Falls back to a fresh findById in the rare case it wasn't stashed (e.g.
  // unit tests that bypass the normal flow).
  const cached = getRequestAccount(req);
  const account = cached !== undefined ? cached : await GameAccount.findById(player.playerId);
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
