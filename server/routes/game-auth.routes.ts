import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import express, { Request, Response } from "express";
import { Jimp } from "jimp";
import mongoose from "mongoose";
import GameAccount from "../models/GameAccount";
import { auth } from "../auth/auth";
import {
  getPlayerFromRequest,
  requireAccount,
} from "../auth/sessionHelper";
import { sanitizeDisplayName } from "../game/playerTokens";
import { BUCKET_NAME, CLOUDFRONT_URL } from "../config/envVars";
import { s3Client } from "../config/s3Client";
import { classifyMongoError } from "../error-handling";
import { profilePictureUpload } from "../middleware/multerUploadMiddleware";
import { authRateLimiter } from "../middleware/rateLimiter";

const router = express.Router();

function handleRouteError(
  error: unknown,
  req: Request,
  res: Response,
  fallbackMessage: string,
) {
  const mongoError = classifyMongoError(error);
  if (mongoError) {
    console.warn(
      `[${req.method} ${req.path}] MongoDB ${mongoError.code}:`,
      error,
    );
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
  return mongoose.connection.readyState === 1;
}

/** Look up a user's email from better-auth's user collection. */
async function getEmailForAccount(accountId: string): Promise<string | undefined> {
  const db = mongoose.connection.getClient().db();
  const baUser = await db.collection("user").findOne({ _id: accountId as any });
  return baUser?.email ?? undefined;
}

function buildPlayerIdentityFromAccount(
  account: {
    id: string;
    displayName: string;
    profilePicture?: string;
    badges?: string[];
    activeBadges?: string[];
    rating?: { overall: { elo: number; gamesPlayed: number } };
  },
  email?: string,
) {
  return {
    playerId: account.id,
    email,
    displayName: account.displayName,
    kind: "account" as const,
    profilePicture: account.profilePicture,
    hasSeenTutorial: false,
    badges: account.badges ?? [],
    activeBadges: account.activeBadges ?? [],
    rating: account.rating?.overall?.elo,
  };
}

function serializeAccountProfile(
  account: {
    displayName: string;
    profilePicture?: string;
    badges?: string[];
    activeBadges?: string[];
    createdAt?: Date;
    updatedAt?: Date;
  },
  email?: string,
  providers?: string[],
) {
  return {
    displayName: account.displayName,
    email,
    profilePicture: account.profilePicture,
    badges: account.badges ?? [],
    activeBadges: account.activeBadges ?? [],
    createdAt: account.createdAt?.toISOString(),
    updatedAt: account.updatedAt?.toISOString(),
    /** Auth providers linked to this account (e.g. "credential", "github", "google") */
    providers: providers ?? [],
  };
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
        message:
          "Account login is unavailable right now. You can still keep playing as a guest.",
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
    const player = account
      ? buildPlayerIdentityFromAccount(account, result.user.email)
      : {
          playerId: result.user.id,
          displayName: result.user.name,
          kind: "account" as const,
          email: result.user.email,
        };

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
    handleRouteError(
      error,
      req,
      res,
      "Unable to load player session right now.",
    );
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
    handleRouteError(
      error,
      req,
      res,
      "Unable to update tutorial status right now.",
    );
  }
});

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

router.get("/profile", async (req: Request, res: Response) => {
  try {
    const account = await requireAccount(req, res);
    if (!account) return;

    const [email, providers] = await Promise.all([
      getEmailForAccount(account.id),
      getProvidersForAccount(account.id),
    ]);
    return res.status(200).json({
      profile: serializeAccountProfile(account, email, providers),
    });
  } catch (error) {
    handleRouteError(error, req, res, "Unable to load profile right now.");
  }
});

router.get("/profile/:username", async (req: Request, res: Response) => {
  try {
    const username = req.params.username?.trim().toLowerCase();
    if (!username) {
      return res
        .status(400)
        .json({ code: "INVALID_USERNAME", message: "Username is required." });
    }

    const account = await GameAccount.findOne({
      displayName: {
        $regex: new RegExp(
          `^${username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
          "i",
        ),
      },
    });
    if (!account) {
      return res
        .status(404)
        .json({ code: "NOT_FOUND", message: "Player not found." });
    }

    return res.status(200).json({
      profile: {
        displayName: account.displayName,
        profilePicture: account.profilePicture,
        createdAt: account.createdAt,
      },
    });
  } catch (error) {
    handleRouteError(error, req, res, "Unable to load profile right now.");
  }
});

router.put("/profile", async (req: Request, res: Response) => {
  try {
    const account = await requireAccount(req, res);
    if (!account) return;

    const { displayName, password, currentPassword } = req.body as {
      displayName?: string;
      password?: string;
      currentPassword?: string;
    };

    const sanitizedDisplayName = displayName?.trim().toLowerCase();

    if (!sanitizedDisplayName && !password) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "Provide a display name or password to update.",
      });
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
      await db.collection("user").updateOne(
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

    const email = await getEmailForAccount(account.id);
    const player = buildPlayerIdentityFromAccount(account, email);
    return res.status(200).json({
      auth: { player },
      profile: serializeAccountProfile(account, email),
    });
  } catch (error: any) {
    if (error?.status === 401 || error?.statusCode === 401) {
      return res.status(401).json({
        code: "INVALID_CREDENTIALS",
        message: "Current password is incorrect.",
      });
    }
    return handleRouteError(
      error,
      req,
      res,
      "Unable to update profile right now.",
    );
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
          console.error(
            "Error deleting previous game account profile picture:",
            error,
          );
        }
      }

      account.profilePicture = `${CLOUDFRONT_URL}/${fileName}`;
      await account.save();

      const email = await getEmailForAccount(account.id);
      const player = buildPlayerIdentityFromAccount(account, email);
      return res.status(200).json({
        auth: { player },
        profile: serializeAccountProfile(account, email),
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

    // Only allow activating badges the player has unlocked
    const unlocked = new Set(account.badges ?? []);
    const validActive = activeBadges.filter((id) => unlocked.has(id));

    account.activeBadges = validActive;
    await account.save();

    const email = await getEmailForAccount(account.id);
    const player = buildPlayerIdentityFromAccount(account, email);
    return res.status(200).json({ auth: { player }, activeBadges: validActive });
  } catch (error) {
    return handleRouteError(
      error,
      req,
      res,
      "Unable to update active badges right now.",
    );
  }
});

export default router;
