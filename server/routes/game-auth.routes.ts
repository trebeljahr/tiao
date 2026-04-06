import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import express, { Request, Response } from "express";
import { Jimp } from "jimp";
import mongoose from "mongoose";
import GameAccount from "../models/GameAccount";
import GameInvitation from "../models/GameInvitation";
import GameRoom from "../models/GameRoom";
import Tournament from "../models/Tournament";
import { gameService, DELETED_PLAYER_NAME } from "../game/gameService";
import { invalidatePlayerProfile } from "../cache/playerIdentityCache";
import { auth } from "../auth/auth";
import { getPlayerFromRequest, requireAccount, requireAdmin } from "../auth/sessionHelper";
import { sanitizeDisplayName } from "../game/playerTokens";
import { isValidUsername } from "../../shared/src";
import { BUCKET_NAME, CLOUDFRONT_URL } from "../config/envVars";
import { s3Client } from "../config/s3Client";
import { classifyMongoError } from "../error-handling";
import { profilePictureUpload } from "../middleware/multerUploadMiddleware";
import { authRateLimiter } from "../middleware/rateLimiter";

const router = express.Router();

function handleRouteError(error: unknown, req: Request, res: Response, fallbackMessage: string) {
  const mongoError = classifyMongoError(error);
  if (mongoError) {
    console.warn(`[${req.method} ${req.path}] MongoDB ${mongoError.code}:`, error);
    return res.status(mongoError.status).json({
      code: mongoError.code,
      message: mongoError.message,
    });
  }

  console.error(`[${req.method} ${req.path}] Unhandled error:`, error);
  return res.status(500).json({
    code: "INTERNAL_ERROR",
    message: fallbackMessage,
  });
}

function isDatabaseReady(): boolean {
  if (process.env.NODE_ENV === "test") return true;
  return mongoose.connection.readyState === 1;
}

/** Look up a user's email from better-auth's user collection. */
async function getEmailForAccount(accountId: string): Promise<string | undefined> {
  const db = mongoose.connection.getClient().db();
  const baUser = await db.collection("user").findOne({ _id: accountId as any });
  return baUser?.email ?? undefined;
}

/** Look up a user's SSO profile image from better-auth's user collection. */
async function getSsoImageForAccount(accountId: string): Promise<string | undefined> {
  try {
    const db = mongoose.connection.getClient().db();
    const baUser = await db
      .collection("user")
      .findOne({ _id: accountId as any }, { projection: { image: 1 } });
    return (baUser?.image as string) || undefined;
  } catch {
    return undefined;
  }
}

function buildPlayerIdentityFromAccount(
  account: {
    id: string;
    displayName: string;
    profilePicture?: string;
    badges?: string[];
    activeBadges?: string[];
    isAdmin?: boolean;
    rating?: { overall: { elo: number; gamesPlayed: number } };
  },
  email?: string,
) {
  const needsUsername = !isValidUsername(account.displayName);
  return {
    playerId: account.id,
    email,
    displayName: account.displayName,
    kind: "account" as const,
    profilePicture: account.profilePicture,
    hasSeenTutorial: false,
    badges: account.badges ?? [],
    activeBadges: account.activeBadges ?? [],
    ...(account.isAdmin ? { isAdmin: true } : {}),
    rating: account.rating?.overall?.elo,
    ...(needsUsername ? { needsUsername: true } : {}),
  };
}

function serializeAccountProfile(
  account: {
    displayName: string;
    profilePicture?: string;
    badges?: string[];
    activeBadges?: string[];
    bio?: string;
    rating?: { overall: { elo: number; gamesPlayed: number } };
    createdAt?: Date;
    updatedAt?: Date;
  },
  email?: string,
  providers?: string[],
  ratingPercentile?: number,
) {
  return {
    displayName: account.displayName,
    email,
    profilePicture: account.profilePicture,
    badges: account.badges ?? [],
    activeBadges: account.activeBadges ?? [],
    bio: account.bio || "",
    rating: account.rating?.overall?.elo ?? 1500,
    gamesPlayed: account.rating?.overall?.gamesPlayed ?? 0,
    ratingPercentile,
    createdAt: account.createdAt?.toISOString(),
    updatedAt: account.updatedAt?.toISOString(),
    /** Auth providers linked to this account (e.g. "credential", "github", "google") */
    providers: providers ?? [],
  };
}

/** Compute the percentile rank of a player's ELO among all players with at least 1 game. */
async function computeRatingPercentile(elo: number): Promise<number | undefined> {
  const totalPlayers = await GameAccount.countDocuments({
    "rating.overall.gamesPlayed": { $gte: 1 },
  });
  if (totalPlayers === 0) return undefined;
  const playersBelow = await GameAccount.countDocuments({
    "rating.overall.gamesPlayed": { $gte: 1 },
    "rating.overall.elo": { $lt: elo },
  });
  // percentile = share of players you are better than (higher = better)
  return Math.round((playersBelow / totalPlayers) * 100);
}

/** Look up which auth providers are linked to an account. */
async function getProvidersForAccount(accountId: string): Promise<string[]> {
  const db = mongoose.connection.getClient().db();
  const accounts = await db
    .collection("account")
    .find({ userId: accountId } as any)
    .toArray();
  return accounts.map((a) => a.providerId as string);
}

// ---------------------------------------------------------------------------
// Custom login wrapper: supports login by username OR email
// better-auth only accepts email, so we resolve username -> email first
// ---------------------------------------------------------------------------

router.post("/login", authRateLimiter, async (req: Request, res: Response) => {
  try {
    if (!isDatabaseReady()) {
      return res.status(503).json({
        code: "SERVICE_UNAVAILABLE",
        message: "Account login is unavailable right now. You can still keep playing as a guest.",
      });
    }

    const { identifier, password } = req.body as {
      identifier?: string;
      password?: string;
    };

    if (
      !identifier ||
      !password ||
      typeof identifier !== "string" ||
      typeof password !== "string"
    ) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "Provide a username or email address, and a password.",
      });
    }

    const trimmed = identifier.trim().toLowerCase();

    // Determine if identifier is an email or username
    let email = trimmed;
    if (!trimmed.includes("@")) {
      // It's a username — look up the email via better-auth user collection
      const account = await GameAccount.findOne({ displayName: trimmed });
      if (!account) {
        return res.status(401).json({
          code: "INVALID_CREDENTIALS",
          message: "Invalid credentials.",
        });
      }
      // Look up the email from better-auth's user collection
      const db = mongoose.connection.getClient().db();
      const baUser = await db.collection("user").findOne({ _id: account._id as any });
      if (!baUser?.email) {
        return res.status(401).json({
          code: "INVALID_CREDENTIALS",
          message: "Invalid credentials.",
        });
      }
      email = baUser.email;
    }

    // Before calling better-auth, verify the user's GameAccount still exists.
    // If it was deleted, the BA user record may linger but the game identity is
    // gone — reject early so the client gets a clear error instead of repeated
    // 404s on downstream endpoints.
    const db = mongoose.connection.getClient().db();
    const baUser = await db.collection("user").findOne({ email } as any);
    if (baUser) {
      const gameAccount = await GameAccount.findById(baUser._id);
      if (!gameAccount) {
        // The BA user record is orphaned — clean it up so the email is freed
        // and future sign-up attempts won't collide.
        await db.collection("account").deleteMany({ userId: baUser._id } as any);
        await db.collection("session").deleteMany({ userId: baUser._id } as any);
        await db.collection("user").deleteOne({ _id: baUser._id });
        return res.status(401).json({
          code: "ACCOUNT_DELETED",
          message: "This account has been deleted. You can create a new one with this email.",
        });
      }
    }

    // Delegate to better-auth's sign-in endpoint and get the raw response
    // (which includes Set-Cookie headers)
    const baResponse = await auth.api.signInEmail({
      body: { email, password },
      asResponse: true,
    });

    if (!baResponse.ok) {
      return res.status(401).json({
        code: "INVALID_CREDENTIALS",
        message: "Invalid credentials.",
      });
    }

    // Forward better-auth's Set-Cookie header to the client
    const setCookie = baResponse.headers.get("set-cookie");
    if (setCookie) {
      res.setHeader("set-cookie", setCookie);
    }

    const result = await baResponse.json();

    // Return a PlayerIdentity-shaped response for backwards compatibility
    const account = await GameAccount.findById(result.user.id);
    if (!account) {
      return res.status(401).json({
        code: "ACCOUNT_DELETED",
        message: "This account has been deleted. You can create a new one with this email.",
      });
    }

    const player = buildPlayerIdentityFromAccount(account, result.user.email);

    return res.status(200).json({ player });
  } catch (error: any) {
    if (error?.status === 401 || error?.statusCode === 401) {
      return res.status(401).json({
        code: "INVALID_CREDENTIALS",
        message: "Invalid credentials.",
      });
    }
    return handleRouteError(error, req, res, "Unable to log in right now.");
  }
});

// ---------------------------------------------------------------------------
// GET /me — returns enriched PlayerIdentity (used by client after session init)
// ---------------------------------------------------------------------------

router.get("/me", async (req: Request, res: Response) => {
  try {
    const player = await getPlayerFromRequest(req);
    if (!player) {
      return res.status(401).json({
        code: "NOT_AUTHENTICATED",
        message: "Not authenticated.",
      });
    }

    return res.status(200).json({ player });
  } catch (error) {
    handleRouteError(error, req, res, "Unable to load player session right now.");
  }
});

// ---------------------------------------------------------------------------
// POST /logout — server-side session invalidation
// ---------------------------------------------------------------------------

router.post("/logout", async (_req: Request, res: Response) => {
  // Session invalidation is handled client-side via better-auth's signOut().
  // This endpoint exists so the server can acknowledge the logout.
  return res.status(204).send();
});

// ---------------------------------------------------------------------------
// SSO username onboarding — set a valid username after social login
// ---------------------------------------------------------------------------

router.post("/set-username", async (req: Request, res: Response) => {
  try {
    const account = await requireAccount(req, res);
    if (!account) return;

    const { username } = req.body as { username?: string };
    const sanitized = username?.trim().toLowerCase();

    if (!sanitized || !isValidUsername(sanitized)) {
      return res.status(400).json({
        code: "INVALID_USERNAME",
        message:
          "Usernames must be 3-32 characters, lowercase, and can only contain letters, numbers, hyphens, and underscores.",
      });
    }

    const existing = await GameAccount.findOne({
      displayName: sanitized,
      _id: { $ne: account._id },
    });

    if (existing) {
      return res.status(409).json({
        code: "DUPLICATE_USERNAME",
        message: "That username is already taken.",
      });
    }

    account.displayName = sanitizeDisplayName(sanitized);
    await account.save();

    // Also update display name in better-auth's user collection
    const db = mongoose.connection.getClient().db();
    await db
      .collection("user")
      .updateOne(
        { _id: account._id },
        { $set: { name: account.displayName, displayName: account.displayName } },
      );

    const email = await getEmailForAccount(account.id);
    const player = buildPlayerIdentityFromAccount(account, email);
    return res.status(200).json({ auth: { player } });
  } catch (error) {
    return handleRouteError(error, req, res, "Unable to set username right now.");
  }
});

// ---------------------------------------------------------------------------
// Tutorial
// ---------------------------------------------------------------------------

router.post("/tutorial-complete", async (req: Request, res: Response) => {
  try {
    const account = await requireAccount(req, res);
    if (!account) return;

    account.hasSeenTutorial = true;
    await account.save();

    const email = await getEmailForAccount(account.id);
    const player = buildPlayerIdentityFromAccount(account, email);
    return res.status(200).json({ auth: { player } });
  } catch (error) {
    handleRouteError(error, req, res, "Unable to update tutorial status right now.");
  }
});

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

router.get("/profile", async (req: Request, res: Response) => {
  try {
    const account = await requireAccount(req, res);
    if (!account) return;

    const elo = account.rating?.overall?.elo ?? 1500;
    const gamesPlayed = account.rating?.overall?.gamesPlayed ?? 0;

    const [email, providers, ssoImage, percentile] = await Promise.all([
      getEmailForAccount(account.id),
      getProvidersForAccount(account.id),
      getSsoImageForAccount(account.id),
      gamesPlayed > 0 ? computeRatingPercentile(elo) : Promise.resolve(undefined),
    ]);

    // Use GameAccount.profilePicture as primary, fall back to SSO image
    const profilePicture = account.profilePicture || ssoImage || undefined;
    return res.status(200).json({
      profile: serializeAccountProfile(
        { ...account.toObject(), profilePicture },
        email,
        providers,
        percentile,
      ),
    });
  } catch (error) {
    handleRouteError(error, req, res, "Unable to load profile right now.");
  }
});

router.get("/profile/:username", async (req: Request, res: Response) => {
  try {
    const username = req.params.username?.trim().toLowerCase();
    if (!username) {
      return res.status(400).json({ code: "INVALID_USERNAME", message: "Username is required." });
    }

    // Try by ID first (stable links), then fall back to display name
    let account = mongoose.Types.ObjectId.isValid(username)
      ? await GameAccount.findById(username)
      : null;
    if (!account) {
      account = await GameAccount.findOne({
        displayName: {
          $regex: new RegExp(`^${username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
        },
      });
    }
    if (!account) {
      return res.status(404).json({ code: "NOT_FOUND", message: "Player not found." });
    }

    // Fall back to better-auth's SSO image if GameAccount has no profile picture
    let profilePicture = account.profilePicture;
    if (!profilePicture) {
      try {
        const db = mongoose.connection.getClient().db();
        const baUser = await db.collection("user").findOne({ _id: account.id as any });
        profilePicture = (baUser?.image as string) || undefined;
      } catch {
        // Non-critical
      }
    }

    const elo = account.rating?.overall?.elo ?? 1500;
    const gamesPlayed = account.rating?.overall?.gamesPlayed ?? 0;
    const percentile = gamesPlayed > 0 ? await computeRatingPercentile(elo) : undefined;
    const playerId = String(account._id);

    // Compute game stats from GameRoom collection
    let gamesWon = 0;
    let gamesLost = 0;
    let favoriteBoard: number | undefined;
    let favoriteTimeControl: string | undefined;
    let favoriteScore: number | undefined;

    if (gamesPlayed > 0) {
      const finishedGames = await GameRoom.find(
        {
          status: "finished",
          $or: [{ "seats.white.playerId": playerId }, { "seats.black.playerId": playerId }],
        },
        {
          "seats.white.playerId": 1,
          "seats.black.playerId": 1,
          "state.score": 1,
          "state.scoreToWin": 1,
          "state.boardSize": 1,
          timeControl: 1,
          ratingBefore: 1,
          ratingAfter: 1,
        },
      )
        .lean()
        .limit(1000);

      const boardCounts: Record<number, number> = {};
      const scoreCounts: Record<number, number> = {};
      const tcCounts: Record<string, number> = {};

      for (const game of finishedGames) {
        const isWhite = game.seats?.white?.playerId === playerId;
        const isBlack = game.seats?.black?.playerId === playerId;
        if (!isWhite && !isBlack) continue;

        const mySeat = isWhite ? "white" : "black";

        // Use ratingAfter vs ratingBefore as the reliable win indicator
        const rBefore = game.ratingBefore as { white: number; black: number } | null;
        const rAfter = game.ratingAfter as { white: number; black: number } | null;
        if (rBefore && rAfter) {
          const myBefore = rBefore[mySeat as "white" | "black"];
          const myAfter = rAfter[mySeat as "white" | "black"];
          if (myAfter > myBefore) gamesWon++;
          else gamesLost++;
        } else {
          // Fallback to score comparison for unrated games
          const score = game.state?.score as { white: number; black: number } | undefined;
          const scoreToWin = game.state?.scoreToWin as number | undefined;
          if (score && scoreToWin) {
            const myScore = isWhite ? score.white : score.black;
            const theirScore = isWhite ? score.black : score.white;
            if (myScore >= scoreToWin || myScore > theirScore) gamesWon++;
            else gamesLost++;
          }
        }

        const bs = game.state?.boardSize as number | undefined;
        if (bs) boardCounts[bs] = (boardCounts[bs] ?? 0) + 1;

        const stw = game.state?.scoreToWin as number | undefined;
        if (stw) scoreCounts[stw] = (scoreCounts[stw] ?? 0) + 1;

        const tc = game.timeControl;
        const tcKey = tc ? `${tc.initialMs / 60_000}+${tc.incrementMs / 1_000}` : "unlimited";
        tcCounts[tcKey] = (tcCounts[tcKey] ?? 0) + 1;
      }

      const maxBy = (counts: Record<string, number>) => {
        let maxKey: string | undefined;
        let maxVal = 0;
        for (const [key, val] of Object.entries(counts)) {
          if (val > maxVal) {
            maxKey = key;
            maxVal = val;
          }
        }
        return maxKey;
      };

      const favBoard = maxBy(boardCounts);
      if (favBoard) favoriteBoard = Number(favBoard);
      favoriteTimeControl = maxBy(tcCounts);
      const favScore = maxBy(scoreCounts);
      if (favScore) favoriteScore = Number(favScore);
    }

    // Use GameRoom-derived totals so won+lost always equals played
    const totalFromGames = gamesWon + gamesLost;

    // Determine friendship status if viewer is logged in
    let friendshipStatus:
      | "none"
      | "friend"
      | "outgoing-request"
      | "incoming-request"
      | "self"
      | undefined;
    try {
      const viewer = await getPlayerFromRequest(req);
      if (viewer) {
        if (viewer.playerId === playerId) {
          friendshipStatus = "self";
        } else {
          const viewerAccount = await GameAccount.findById(viewer.playerId);
          if (viewerAccount) {
            const targetId = playerId;
            if (viewerAccount.friends.some((id: any) => String(id) === targetId)) {
              friendshipStatus = "friend";
            } else if (
              viewerAccount.sentFriendRequests.some((id: any) => String(id) === targetId)
            ) {
              friendshipStatus = "outgoing-request";
            } else if (
              viewerAccount.receivedFriendRequests.some((id: any) => String(id) === targetId)
            ) {
              friendshipStatus = "incoming-request";
            } else {
              friendshipStatus = "none";
            }
          }
        }
      }
    } catch {
      // Non-critical — viewer just won't see friendship status
    }

    return res.status(200).json({
      profile: {
        playerId,
        displayName: account.displayName,
        profilePicture,
        rating: elo,
        gamesPlayed: totalFromGames > 0 ? totalFromGames : gamesPlayed,
        gamesWon,
        gamesLost,
        ratingPercentile: percentile,
        createdAt: account.createdAt,
        bio: account.bio || undefined,
        badges: account.badges,
        activeBadges: account.activeBadges,
        favoriteBoard,
        favoriteTimeControl,
        favoriteScore,
        friendshipStatus,
      },
    });
  } catch (error) {
    handleRouteError(error, req, res, "Unable to load profile right now.");
  }
});

router.get("/profile/:username/games", async (req: Request, res: Response) => {
  try {
    const username = req.params.username?.trim().toLowerCase();
    if (!username) {
      return res.status(400).json({ code: "INVALID_USERNAME", message: "Username is required." });
    }

    let account = mongoose.Types.ObjectId.isValid(username)
      ? await GameAccount.findById(username)
      : null;
    if (!account) {
      account = await GameAccount.findOne({
        displayName: {
          $regex: new RegExp(`^${username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
        },
      });
    }
    if (!account) {
      return res.status(404).json({ code: "NOT_FOUND", message: "Player not found." });
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const before = req.query.before ? new Date(req.query.before as string) : undefined;
    if (before && isNaN(before.getTime())) {
      return res.status(400).json({ code: "INVALID_CURSOR", message: "Invalid 'before' date." });
    }

    const playerId = String(account._id);
    const result = await gameService.listFinishedGames(playerId, limit, before);

    res.json({ playerId, games: result.games, hasMore: result.hasMore });
  } catch (error) {
    handleRouteError(error, req, res, "Unable to load match history right now.");
  }
});

router.put("/profile", async (req: Request, res: Response) => {
  try {
    const account = await requireAccount(req, res);
    if (!account) return;

    const { displayName, password, currentPassword, bio } = req.body as {
      displayName?: string;
      password?: string;
      currentPassword?: string;
      bio?: string;
    };

    const sanitizedDisplayName = displayName?.trim().toLowerCase();

    if (!sanitizedDisplayName && !password && bio === undefined) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "Provide a display name, password, or bio to update.",
      });
    }

    if (bio !== undefined) {
      account.bio = (bio || "").slice(0, 500).trim();
    }

    if (sanitizedDisplayName !== undefined) {
      if (
        !sanitizedDisplayName ||
        sanitizedDisplayName.length < 3 ||
        sanitizedDisplayName.length > 32
      ) {
        return res.status(400).json({
          code:
            !sanitizedDisplayName || sanitizedDisplayName.length < 3
              ? "DISPLAY_NAME_TOO_SHORT"
              : "DISPLAY_NAME_TOO_LONG",
          message: "Usernames must be between 3 and 32 characters.",
        });
      }

      if (!/^[a-z0-9][a-z0-9_-]*$/.test(sanitizedDisplayName)) {
        return res.status(400).json({
          code: "INVALID_DISPLAY_NAME",
          message:
            "Usernames must be lowercase and can only contain letters, numbers, hyphens, and underscores.",
        });
      }

      const existingAccountByDisplayName = await GameAccount.findOne({
        displayName: sanitizedDisplayName,
        _id: { $ne: account._id },
      });

      if (existingAccountByDisplayName) {
        return res.status(409).json({
          code: "DUPLICATE_USERNAME",
          message: "That username is already taken.",
        });
      }

      account.displayName = sanitizeDisplayName(sanitizedDisplayName);

      // Also update display name in better-auth's user collection
      const db = mongoose.connection.getClient().db();
      await db
        .collection("user")
        .updateOne(
          { _id: account._id },
          { $set: { name: account.displayName, displayName: account.displayName } },
        );
    }

    if (password !== undefined) {
      if (!currentPassword) {
        return res.status(400).json({
          code: "CURRENT_PASSWORD_REQUIRED",
          message: "Current password is required to set a new password.",
        });
      }

      if (password.length < 8) {
        return res.status(400).json({
          code: "INVALID_PASSWORD",
          message: "Passwords must be at least 8 characters long.",
        });
      }

      // Use better-auth's change password API
      await auth.api.changePassword({
        body: {
          currentPassword,
          newPassword: password,
        },
        headers: req.headers as any,
      });
    }

    await account.save();

    const [email, providers] = await Promise.all([
      getEmailForAccount(account.id),
      getProvidersForAccount(account.id),
    ]);
    const player = buildPlayerIdentityFromAccount(account, email);

    // Propagate updated identity to active games in the background
    gameService.refreshPlayerInActiveRooms(player).catch((err) => {
      console.error("Failed to refresh player identity in active rooms:", err);
    });

    return res.status(200).json({
      auth: { player },
      profile: serializeAccountProfile(account, email, providers),
    });
  } catch (error: any) {
    if (error?.status === 401 || error?.statusCode === 401) {
      return res.status(401).json({
        code: "INVALID_CREDENTIALS",
        message: "Current password is incorrect.",
      });
    }
    return handleRouteError(error, req, res, "Unable to update profile right now.");
  }
});

// ---------------------------------------------------------------------------
// Set password (for SSO-only users who want to add credential login)
// ---------------------------------------------------------------------------

router.post("/set-password", async (req: Request, res: Response) => {
  try {
    const account = await requireAccount(req, res);
    if (!account) return;

    const { password } = req.body ?? {};
    if (!password || typeof password !== "string") {
      return res.status(400).json({
        code: "MISSING_PASSWORD",
        message: "Password is required.",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        code: "INVALID_PASSWORD",
        message: "Passwords must be at least 8 characters long.",
      });
    }

    const providers = await getProvidersForAccount(account.id);
    if (providers.includes("credential")) {
      return res.status(409).json({
        code: "CREDENTIAL_EXISTS",
        message: "This account already has a password. Use change password instead.",
      });
    }

    // Hash the password using bcrypt (same config as better-auth)
    const bcrypt = await import("bcrypt");
    const hashedPassword = await bcrypt.hash(password, 10);

    // Get the user's email from better-auth
    const email = await getEmailForAccount(account.id);
    if (!email) {
      return res.status(400).json({
        code: "NO_EMAIL",
        message: "Cannot set a password without an email address.",
      });
    }

    // Insert a credential account entry into better-auth's account collection
    const db = mongoose.connection.getClient().db();
    await db.collection("account").insertOne({
      userId: account.id,
      providerId: "credential",
      accountId: account.id,
      password: hashedPassword,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const updatedProviders = await getProvidersForAccount(account.id);
    return res.status(200).json({ providers: updatedProviders });
  } catch (error) {
    return handleRouteError(error, req, res, "Unable to set password right now.");
  }
});

// ---------------------------------------------------------------------------
// Profile picture
// ---------------------------------------------------------------------------

router.post(
  "/profile-picture",
  profilePictureUpload("profilePicture"),
  async (req: Request, res: Response) => {
    const account = await requireAccount(req, res);
    if (!account) return;

    if (!req.file) {
      return res.status(400).json({
        code: "MISSING_FILE",
        message: "Choose an image to upload.",
      });
    }

    try {
      const fileName = `game-account-${account.id}-${randomUUID()}.jpeg`;
      const image = await Jimp.read(req.file.buffer);
      image.resize({ w: 320 });

      const processedImageBuffer = await image.getBuffer("image/jpeg");

      const uploadCommand = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: fileName,
        Body: processedImageBuffer,
        ContentType: "image/jpeg",
      });

      await s3Client.send(uploadCommand);

      if (account.profilePicture?.startsWith(`${CLOUDFRONT_URL}/`)) {
        try {
          const previousKey = account.profilePicture.split("/").pop();
          if (previousKey) {
            await s3Client.send(
              new DeleteObjectCommand({
                Bucket: BUCKET_NAME,
                Key: previousKey,
              }),
            );
          }
        } catch (error) {
          console.error("Error deleting previous game account profile picture:", error);
        }
      }

      account.profilePicture = `${CLOUDFRONT_URL}/${fileName}`;
      await account.save();

      const [email, providers] = await Promise.all([
        getEmailForAccount(account.id),
        getProvidersForAccount(account.id),
      ]);
      const player = buildPlayerIdentityFromAccount(account, email);

      // Propagate updated identity to active games in the background
      gameService.refreshPlayerInActiveRooms(player).catch((err) => {
        console.error("Failed to refresh player identity in active rooms:", err);
      });

      return res.status(200).json({
        auth: { player },
        profile: serializeAccountProfile(account, email, providers),
      });
    } catch (error) {
      console.error("Error uploading game account profile picture:", error);
      return res.status(500).json({
        code: "UPLOAD_FAILED",
        message: "Unable to upload that profile picture right now.",
      });
    }
  },
);

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

router.put("/badges/active", async (req: Request, res: Response) => {
  try {
    const account = await requireAccount(req, res);
    if (!account) return;

    const { activeBadges } = req.body as { activeBadges?: string[] };

    if (!Array.isArray(activeBadges)) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "activeBadges must be an array of badge IDs.",
      });
    }

    // Validate badge IDs and enforce single-badge selection.
    // NOTE: We validate against KNOWN_BADGE_IDS rather than account.badges
    // because badge entitlements are still hardcoded on the client during
    // preview. Once Stripe entitlements are wired up, this should go back
    // to checking account.badges.
    const KNOWN_BADGE_IDS = new Set([
      "supporter",
      "contributor",
      "super-supporter",
      "official-champion",
      "creator",
      "badge-1",
      "badge-2",
      "badge-3",
      "badge-4",
      "badge-5",
      "badge-6",
      "badge-7",
      "badge-8",
    ]);
    const validActive = activeBadges.filter((id) => KNOWN_BADGE_IDS.has(id)).slice(0, 1);

    account.activeBadges = validActive;
    await account.save();

    // Notify friends via lobby WebSocket so their UIs update in real time
    for (const friendId of account.friends) {
      gameService.broadcastLobby(friendId.toString(), {
        type: "social-update",
      });
    }

    const email = await getEmailForAccount(account.id);
    const player = buildPlayerIdentityFromAccount(account, email);

    // Propagate updated badges to active games in the background
    gameService.refreshPlayerInActiveRooms(player).catch((err) => {
      console.error("Failed to refresh player identity in active rooms:", err);
    });

    return res.status(200).json({ auth: { player }, activeBadges: validActive });
  } catch (error) {
    return handleRouteError(error, req, res, "Unable to update active badges right now.");
  }
});

// ---------------------------------------------------------------------------
// Admin: badge management
// ---------------------------------------------------------------------------

router.post("/admin/badges/grant", async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { playerId, badgeId } = req.body as { playerId?: string; badgeId?: string };

    if (!playerId || typeof playerId !== "string" || !badgeId || typeof badgeId !== "string") {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "Provide playerId and badgeId.",
      });
    }

    const target = await GameAccount.findById(playerId);
    if (!target) {
      return res.status(404).json({
        code: "ACCOUNT_NOT_FOUND",
        message: "Target account not found.",
      });
    }

    if (!target.badges.includes(badgeId)) {
      target.badges.push(badgeId);
      await target.save();
    }

    return res.status(200).json({
      badges: target.badges,
      activeBadges: target.activeBadges,
    });
  } catch (error) {
    return handleRouteError(error, req, res, "Unable to grant badge right now.");
  }
});

router.post("/admin/badges/revoke", async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { playerId, badgeId } = req.body as { playerId?: string; badgeId?: string };

    if (!playerId || typeof playerId !== "string" || !badgeId || typeof badgeId !== "string") {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "Provide playerId and badgeId.",
      });
    }

    const target = await GameAccount.findById(playerId);
    if (!target) {
      return res.status(404).json({
        code: "ACCOUNT_NOT_FOUND",
        message: "Target account not found.",
      });
    }

    target.badges = target.badges.filter((id: string) => id !== badgeId);
    // Also remove from activeBadges if it was displayed
    target.activeBadges = target.activeBadges.filter((id: string) => id !== badgeId);
    await target.save();

    return res.status(200).json({
      badges: target.badges,
      activeBadges: target.activeBadges,
    });
  } catch (error) {
    return handleRouteError(error, req, res, "Unable to revoke badge right now.");
  }
});

// ---------------------------------------------------------------------------
// DELETE /account — permanently delete account with GDPR-compliant anonymization
// ---------------------------------------------------------------------------

router.delete("/account", async (req: Request, res: Response) => {
  try {
    const account = await requireAccount(req, res);
    if (!account) return;

    const { displayName } = req.body as { displayName?: string };

    if (!displayName || displayName !== account.displayName) {
      return res.status(400).json({
        code: "DISPLAY_NAME_MISMATCH",
        message: "You must type your exact display name to confirm account deletion.",
      });
    }

    const accountId = String(account._id);

    // (a) Forfeit active games (via gameService for real-time broadcast) and delete waiting games
    const activeOrWaitingGames = await GameRoom.find({
      status: { $in: ["waiting", "active"] },
      $or: [{ "seats.white.playerId": accountId }, { "seats.black.playerId": accountId }],
    });

    const forfeitedGameIds: string[] = [];
    for (const game of activeOrWaitingGames) {
      if (game.status === "waiting") {
        await GameRoom.deleteOne({ _id: game._id });
      } else if (game.status === "active") {
        // Use gameService to forfeit so the opponent gets a real-time WebSocket notification
        try {
          await gameService.forfeitForPlayer(game.roomId, accountId);
          forfeitedGameIds.push(game.roomId);
        } catch {
          // Fallback: direct DB update if gameService fails
          const isWhite = game.seats?.white?.playerId === accountId;
          const winnerColor = isWhite ? "black" : "white";
          await GameRoom.updateOne(
            { _id: game._id },
            {
              $set: {
                status: "finished",
                "state.winner": winnerColor,
              },
            },
          );
          forfeitedGameIds.push(game.roomId);
        }
      }
    }

    // (b) Anonymize game history (GDPR) — replace user identity in finished games
    const ANON_NAME = DELETED_PLAYER_NAME;
    await Promise.all([
      GameRoom.updateMany(
        { "seats.white.playerId": accountId, status: "finished" },
        {
          $set: {
            "seats.white.displayName": ANON_NAME,
            "seats.white.kind": "guest",
          },
        },
      ),
      GameRoom.updateMany(
        { "seats.black.playerId": accountId, status: "finished" },
        {
          $set: {
            "seats.black.displayName": ANON_NAME,
            "seats.black.kind": "guest",
          },
        },
      ),
    ]);

    // Re-broadcast snapshots for forfeited games so opponents see "Deleted Player" immediately
    for (const roomId of forfeitedGameIds) {
      try {
        await gameService.rebroadcastSnapshot(roomId);
      } catch {
        // Best-effort — opponent will see it on next refresh
      }
    }

    // (c) Tournament identity is resolved from cache at read time.
    // Since the GameAccount is deleted and cache invalidated above,
    // the enrichment step in toSnapshot() will return no data for this player,
    // effectively anonymizing them without needing to update tournament docs.

    // (d) Remove user's ID from all other accounts' friend lists
    await GameAccount.updateMany(
      {},
      {
        $pull: {
          friends: account._id,
          sentFriendRequests: account._id,
          receivedFriendRequests: account._id,
        } as any,
      },
    );

    // (e) Delete all game invitations involving this user
    await GameInvitation.deleteMany({
      $or: [{ senderId: account._id }, { recipientId: account._id }],
    });

    // (f) Delete profile picture from S3 if it's a CloudFront URL
    if (account.profilePicture?.startsWith(`${CLOUDFRONT_URL}/`)) {
      try {
        const s3Key = account.profilePicture.split("/").pop();
        if (s3Key) {
          await s3Client.send(
            new DeleteObjectCommand({
              Bucket: BUCKET_NAME,
              Key: s3Key,
            }),
          );
        }
      } catch (error) {
        console.error("Error deleting profile picture from S3 during account deletion:", error);
      }
    }

    // (g) Delete the GameAccount document and invalidate cache
    await GameAccount.deleteOne({ _id: account._id });
    invalidatePlayerProfile(accountId);

    // (h) Delete better-auth data (user, session, account, verification collections)
    const db = mongoose.connection.getClient().db();
    const userDoc = await db.collection("user").findOne({ _id: accountId as any });
    await Promise.all([
      db.collection("user").deleteOne({ _id: accountId as any }),
      db.collection("session").deleteMany({ userId: accountId } as any),
      db.collection("account").deleteMany({ userId: accountId } as any),
      db.collection("verification").deleteMany({ identifier: userDoc?.email } as any),
    ]);

    return res.status(200).json({ message: "Account deleted successfully." });
  } catch (error) {
    return handleRouteError(error, req, res, "Unable to delete account right now.");
  }
});

export default router;
