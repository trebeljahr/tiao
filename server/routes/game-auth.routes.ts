import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import bcrypt from "bcrypt";
import { randomUUID } from "crypto";
import express, { NextFunction, Request, Response } from "express";
import { Jimp } from "jimp";
import mongoose from "mongoose";
import GameAccount from "../models/GameAccount";
import GameRoom from "../models/GameRoom";
import {
  clearPlayerSession,
  commitPlayerSession,
  createAccountAuth,
  createGuestAuth,
  deriveDisplayNameFromEmail,
  getPlayerFromRequest,
  refreshPlayerSession,
  sanitizeDisplayName,
} from "../game/playerTokens";
import { BUCKET_NAME, CLOUDFRONT_URL } from "../config/envVars";
import { s3Client } from "../config/s3Client";
import { classifyMongoError } from "../error-handling";
import { profilePictureUpload } from "../middleware/multerUploadMiddleware";
import { authRateLimiter } from "../middleware/rateLimiter";

const router = express.Router();
const saltRounds = 10;

function handleRouteError(
  error: unknown,
  req: Request,
  res: Response,
  fallbackMessage: string
) {
  const mongoError = classifyMongoError(error);
  if (mongoError) {
    console.warn(
      `[${req.method} ${req.path}] MongoDB ${mongoError.code}:`,
      error
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

/**
 * @openapi
 * components:
 *   schemas:
 *     PlayerIdentity:
 *       type: object
 *       properties:
 *         playerId:
 *           type: string
 *         displayName:
 *           type: string
 *         kind:
 *           type: string
 *           enum: [guest, account]
 *         email:
 *           type: string
 *         profilePicture:
 *           type: string
 *     AuthResponse:
 *       type: object
 *       properties:
 *         player:
 *           $ref: '#/components/schemas/PlayerIdentity'
 *     MultiplayerSnapshot:
 *       type: object
 *       properties:
 *         gameId:
 *           type: string
 *         roomType:
 *           type: string
 *           enum: [direct, matchmaking]
 *         status:
 *           type: string
 *           enum: [waiting, active, finished]
 *         state:
 *           type: object
 *         players:
 *           type: array
 *           items:
 *             type: object
 *         seats:
 *           type: object
 *         rematch:
 *           type: object
 *           nullable: true
 *     MatchmakingState:
 *       type: object
 *       properties:
 *         status:
 *           type: string
 *           enum: [idle, searching, matched]
 *     SocialOverview:
 *       type: object
 *       properties:
 *         friends:
 *           type: array
 *           items:
 *             type: object
 *         incomingFriendRequests:
 *           type: array
 *           items:
 *             type: object
 *         outgoingFriendRequests:
 *           type: array
 *           items:
 *             type: object
 *         incomingInvitations:
 *           type: array
 *           items:
 *             type: object
 *         outgoingInvitations:
 *           type: array
 *           items:
 *             type: object
 *   securitySchemes:
 *     sessionCookie:
 *       type: apiKey
 *       in: cookie
 *       name: tiao.session
 */

function isDatabaseReady(): boolean {
  return mongoose.connection.readyState === 1;
}

function buildAccountAuth(account: {
  id: string;
  email?: string;
  displayName: string;
  profilePicture?: string;
}) {
  return createAccountAuth({
    id: account.id,
    email: account.email,
    displayName: account.displayName,
    profilePicture: account.profilePicture,
  });
}

function serializeAccountProfile(account: {
  displayName: string;
  email?: string;
  profilePicture?: string;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  return {
    displayName: account.displayName,
    email: account.email,
    profilePicture: account.profilePicture,
    createdAt: account.createdAt?.toISOString(),
    updatedAt: account.updatedAt?.toISOString(),
  };
}

async function requireAccount(req: Request, res: Response) {
  if (!isDatabaseReady()) {
    res.status(503).json({
      code: "SERVICE_UNAVAILABLE",
      message:
        "Account features are unavailable right now. You can still keep playing as a guest.",
    });
    return null;
  }

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
      message: "Only account players can edit a server profile.",
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
 * @openapi
 * /api/player/guest:
 *   post:
 *     summary: Create a guest session
 *     tags:
 *       - Authentication
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               displayName:
 *                 type: string
 *     responses:
 *       201:
 *         description: Guest session created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 */
router.post("/guest", async (req: Request, res: Response) => {
  try {
    const { displayName } = req.body as {
      displayName?: string;
    };

    const auth = createGuestAuth(displayName);
    await commitPlayerSession(req, res, auth.player);
    res.status(201).json(auth);
  } catch (error) {
    handleRouteError(error, req, res, "Unable to create a guest session right now.");
  }
});

/**
 * @openapi
 * /api/player/signup:
 *   post:
 *     summary: Create a new account
 *     tags:
 *       - Authentication
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 8
 *               displayName:
 *                 type: string
 *                 minLength: 3
 *     responses:
 *       201:
 *         description: Account created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       400:
 *         description: Validation error (missing fields, short password, short username, invalid email)
 *       409:
 *         description: Email or username already taken
 *       503:
 *         description: Account signup unavailable
 */
router.post("/signup", authRateLimiter, async (req: Request, res: Response) => {
  try {
    if (!isDatabaseReady()) {
      return res.status(503).json({
        code: "SERVICE_UNAVAILABLE",
        message:
          "Account signup is unavailable right now. You can still keep playing as a guest.",
      });
    }

    const { email, password, displayName } = req.body as {
      email?: string;
      password?: string;
      displayName?: string;
    };

    const normalizedEmail = email?.trim().toLowerCase();
    const trimmedDisplayName = displayName?.trim().toLowerCase();

    if (
      !password ||
      typeof password !== "string" ||
      (!normalizedEmail && !trimmedDisplayName)
    ) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "Provide a username or email address, and a password.",
      });
    }

    if (normalizedEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
      if (!emailRegex.test(normalizedEmail)) {
        return res.status(400).json({
          code: "INVALID_EMAIL",
          message: "Provide a valid email address.",
        });
      }

      const existingAccountByEmail = await GameAccount.findOne({
        email: normalizedEmail,
      });

      if (existingAccountByEmail) {
        return res.status(409).json({
          code: "DUPLICATE_EMAIL",
          message: "An account with that email already exists.",
        });
      }
    }

    if (trimmedDisplayName) {
      if (trimmedDisplayName.length < 3 || trimmedDisplayName.length > 32) {
        return res.status(400).json({
          code: trimmedDisplayName.length < 3 ? "DISPLAY_NAME_TOO_SHORT" : "DISPLAY_NAME_TOO_LONG",
          message: "Usernames must be between 3 and 32 characters.",
        });
      }

      if (!/^[a-z0-9][a-z0-9_-]*$/.test(trimmedDisplayName)) {
        return res.status(400).json({
          code: "INVALID_DISPLAY_NAME",
          message:
            "Usernames must be lowercase and can only contain letters, numbers, hyphens, and underscores.",
        });
      }

      const existingAccountByDisplayName = await GameAccount.findOne({
        displayName: trimmedDisplayName,
      });

      if (existingAccountByDisplayName) {
        return res.status(409).json({
          code: "DUPLICATE_USERNAME",
          message: "That username is already taken.",
        });
      }
    }

    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({
        code: "INVALID_PASSWORD",
        message: "Passwords must be between 8 and 128 characters.",
      });
    }

    // Capture the current guest identity before replacing the session
    const currentPlayer = await getPlayerFromRequest(req);
    const guestPlayerId = currentPlayer?.kind === "guest" ? currentPlayer.playerId : null;

    const passwordHash = bcrypt.hashSync(password, saltRounds);
    const account = await GameAccount.create({
      email: normalizedEmail || undefined,
      passwordHash,
      displayName: trimmedDisplayName || (normalizedEmail ? deriveDisplayNameFromEmail(normalizedEmail) : `Player-${randomUUID().slice(0, 8)}`),
    });

    const auth = buildAccountAuth(account);

    // Migrate guest's unfinished games to the new account
    if (guestPlayerId) {
      const newIdentity = auth.player;
      await GameRoom.updateMany(
        { status: { $in: ["waiting", "active"] }, "players.playerId": guestPlayerId },
        { $set: { "players.$[p].playerId": newIdentity.playerId, "players.$[p].displayName": newIdentity.displayName, "players.$[p].kind": newIdentity.kind } },
        { arrayFilters: [{ "p.playerId": guestPlayerId }] },
      );
      await GameRoom.updateMany(
        { status: { $in: ["waiting", "active"] }, "seats.white.playerId": guestPlayerId },
        { $set: { "seats.white.playerId": newIdentity.playerId, "seats.white.displayName": newIdentity.displayName, "seats.white.kind": newIdentity.kind } },
      );
      await GameRoom.updateMany(
        { status: { $in: ["waiting", "active"] }, "seats.black.playerId": guestPlayerId },
        { $set: { "seats.black.playerId": newIdentity.playerId, "seats.black.displayName": newIdentity.displayName, "seats.black.kind": newIdentity.kind } },
      );
    }

    await commitPlayerSession(req, res, auth.player);
    return res.status(201).json(auth);
  } catch (error) {
    return handleRouteError(error, req, res, "Unable to create that account right now.");
  }
});

/**
 * @openapi
 * /api/player/login:
 *   post:
 *     summary: Log in to an existing account
 *     tags:
 *       - Authentication
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - identifier
 *               - password
 *             properties:
 *               identifier:
 *                 type: string
 *                 description: Username or email address
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       400:
 *         description: Missing identifier or password
 *       401:
 *         description: Account not found or incorrect password
 *       503:
 *         description: Account login unavailable
 */
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

    const trimmedIdentifier = identifier.trim();
    const lowercaseIdentifier = trimmedIdentifier.toLowerCase();

    const account = await GameAccount.findOne({
      $or: [
        { email: lowercaseIdentifier },
        { displayName: trimmedIdentifier },
      ],
    });

    if (!account) {
      return res.status(401).json({
        code: "INVALID_CREDENTIALS",
        message: "Invalid credentials.",
      });
    }

    const passwordMatches = bcrypt.compareSync(password, account.passwordHash);
    if (!passwordMatches) {
      return res.status(401).json({
        code: "INVALID_CREDENTIALS",
        message: "Invalid credentials.",
      });
    }

    const auth = buildAccountAuth(account);
    await commitPlayerSession(req, res, auth.player);
    return res.status(200).json(auth);
  } catch (error) {
    return handleRouteError(error, req, res, "Unable to log in right now.");
  }
});

/**
 * @openapi
 * /api/player/logout:
 *   post:
 *     summary: Destroy the current session
 *     tags:
 *       - Authentication
 *     security:
 *       - sessionCookie: []
 *     responses:
 *       204:
 *         description: Session destroyed
 */
router.post("/logout", async (req: Request, res: Response) => {
  try {
    await clearPlayerSession(req, res);
    return res.status(204).send();
  } catch (error) {
    handleRouteError(error, req, res, "Unable to log out right now.");
  }
});

/**
 * @openapi
 * /api/player/me:
 *   get:
 *     summary: Get the current authenticated player
 *     tags:
 *       - Authentication
 *     security:
 *       - sessionCookie: []
 *     responses:
 *       200:
 *         description: Current player identity
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 player:
 *                   $ref: '#/components/schemas/PlayerIdentity'
 *       401:
 *         description: Not authenticated or session no longer valid
 */
router.get("/me", async (req: Request, res: Response) => {
  try {
    const player = await getPlayerFromRequest(req);
    if (!player) {
      return res.status(401).json({
        code: "NOT_AUTHENTICATED",
        message: "Not authenticated.",
      });
    }

    if (player.kind === "account" && isDatabaseReady()) {
      const account = await GameAccount.findById(player.playerId);
      if (account) {
        const auth = buildAccountAuth(account);
        await refreshPlayerSession(req, res, auth.player);
        return res.status(200).json({
          player: auth.player,
        });
      }

      await clearPlayerSession(req, res);
      return res.status(401).json({
        code: "SESSION_EXPIRED",
        message: "That account session is no longer valid.",
      });
    }

    await refreshPlayerSession(req, res, player);
    return res.status(200).json({ player });
  } catch (error) {
    handleRouteError(error, req, res, "Unable to load player session right now.");
  }
});

/**
 * @openapi
 * /api/player/tutorial-complete:
 *   post:
 *     summary: Mark the tutorial as completed for the current account
 *     tags:
 *       - Authentication
 *     security:
 *       - sessionCookie: []
 *     responses:
 *       200:
 *         description: Tutorial marked as completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 auth:
 *                   $ref: '#/components/schemas/AuthResponse'
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Only account players can mark tutorial complete
 *       404:
 *         description: Account not found
 *       503:
 *         description: Account features unavailable
 */
router.post("/tutorial-complete", async (req: Request, res: Response) => {
  try {
    const account = await requireAccount(req, res);
    if (!account) {
      return;
    }

    account.hasSeenTutorial = true;
    await account.save();

    const auth = buildAccountAuth(account);
    await refreshPlayerSession(req, res, auth.player);
    return res.status(200).json({ auth });
  } catch (error) {
    handleRouteError(error, req, res, "Unable to update tutorial status right now.");
  }
});

/**
 * @openapi
 * /api/player/profile:
 *   get:
 *     summary: Get the current account profile
 *     tags:
 *       - Profile
 *     security:
 *       - sessionCookie: []
 *     responses:
 *       200:
 *         description: Account profile
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 profile:
 *                   type: object
 *                   properties:
 *                     displayName:
 *                       type: string
 *                     email:
 *                       type: string
 *                     profilePicture:
 *                       type: string
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Only account players can access profiles
 *       404:
 *         description: Account not found
 *       503:
 *         description: Account features unavailable
 */
router.get("/profile", async (req: Request, res: Response) => {
  try {
    const account = await requireAccount(req, res);
    if (!account) {
      return;
    }

    return res.status(200).json({
      profile: serializeAccountProfile(account),
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

    const account = await GameAccount.findOne({ displayName: { $regex: new RegExp(`^${username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") } });
    if (!account) {
      return res.status(404).json({ code: "NOT_FOUND", message: "Player not found." });
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

/**
 * @openapi
 * /api/player/profile:
 *   put:
 *     summary: Update the current account profile
 *     tags:
 *       - Profile
 *     security:
 *       - sessionCookie: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               displayName:
 *                 type: string
 *                 minLength: 3
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 8
 *     responses:
 *       200:
 *         description: Profile updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 auth:
 *                   $ref: '#/components/schemas/AuthResponse'
 *                 profile:
 *                   type: object
 *                   properties:
 *                     displayName:
 *                       type: string
 *                     email:
 *                       type: string
 *                     profilePicture:
 *                       type: string
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Validation error (no fields provided, short display name, short password, invalid email)
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Only account players can edit profiles
 *       404:
 *         description: Account not found
 *       409:
 *         description: Username or email already taken
 *       503:
 *         description: Account features unavailable
 */
router.put("/profile", async (req: Request, res: Response) => {
  try {
    const account = await requireAccount(req, res);
    if (!account) {
      return;
    }

    const { displayName, email, password, currentPassword } = req.body as {
      displayName?: string;
      email?: string;
      password?: string;
      currentPassword?: string;
    };

    const normalizedEmail = email?.trim().toLowerCase();
    const sanitizedDisplayName = displayName?.trim().toLowerCase();

    if (!normalizedEmail && !sanitizedDisplayName && !password) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "Provide a display name, email address, or password to update.",
      });
    }

    if (sanitizedDisplayName !== undefined) {
      if (!sanitizedDisplayName || sanitizedDisplayName.length < 3 || sanitizedDisplayName.length > 32) {
        return res.status(400).json({
          code: !sanitizedDisplayName || sanitizedDisplayName.length < 3 ? "DISPLAY_NAME_TOO_SHORT" : "DISPLAY_NAME_TOO_LONG",
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
    }

    if (normalizedEmail !== undefined) {
      if (normalizedEmail) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
        if (!emailRegex.test(normalizedEmail)) {
          return res.status(400).json({
            code: "INVALID_EMAIL",
            message: "Provide a valid email address.",
          });
        }

        const existingAccount = await GameAccount.findOne({
          email: normalizedEmail,
          _id: { $ne: account._id },
        });

        if (existingAccount) {
          return res.status(409).json({
            code: "DUPLICATE_EMAIL",
            message: "An account with that email already exists.",
          });
        }

        account.email = normalizedEmail;
      } else {
        account.email = undefined;
      }
    }

    if (password !== undefined) {
      if (!currentPassword) {
        return res.status(400).json({
          code: "CURRENT_PASSWORD_REQUIRED",
          message: "Current password is required to set a new password.",
        });
      }

      const passwordMatches = bcrypt.compareSync(currentPassword, account.passwordHash);
      if (!passwordMatches) {
        return res.status(401).json({
          code: "INVALID_CREDENTIALS",
          message: "Current password is incorrect.",
        });
      }

      if (password.length < 8) {
        return res.status(400).json({
          code: "INVALID_PASSWORD",
          message: "Passwords must be at least 8 characters long.",
        });
      }

      account.passwordHash = bcrypt.hashSync(password, saltRounds);
    }

    await account.save();

    const auth = buildAccountAuth(account);
    await refreshPlayerSession(req, res, auth.player);
    return res.status(200).json({
      auth,
      profile: serializeAccountProfile(account),
    });
  } catch (error) {
    return handleRouteError(error, req, res, "Unable to update profile right now.");
  }
});

/**
 * @openapi
 * /api/player/profile-picture:
 *   post:
 *     summary: Upload a profile picture
 *     tags:
 *       - Profile
 *     security:
 *       - sessionCookie: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - profilePicture
 *             properties:
 *               profilePicture:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Profile picture uploaded
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 auth:
 *                   $ref: '#/components/schemas/AuthResponse'
 *                 profile:
 *                   type: object
 *                   properties:
 *                     displayName:
 *                       type: string
 *                     email:
 *                       type: string
 *                     profilePicture:
 *                       type: string
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: No image file provided
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Only account players can upload profile pictures
 *       404:
 *         description: Account not found
 *       500:
 *         description: Upload failed
 *       503:
 *         description: Account features unavailable
 */
router.post(
  "/profile-picture",
  profilePictureUpload("profilePicture"),
  async (req: Request, res: Response) => {
    const account = await requireAccount(req, res);
    if (!account) {
      return;
    }

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
              })
            );
          }
        } catch (error) {
          console.error("Error deleting previous game account profile picture:", error);
        }
      }

      account.profilePicture = `${CLOUDFRONT_URL}/${fileName}`;
      await account.save();

      const auth = buildAccountAuth(account);
      await refreshPlayerSession(req, res, auth.player);
      return res.status(200).json({
        auth,
        profile: serializeAccountProfile(account),
      });
    } catch (error) {
      console.error("Error uploading game account profile picture:", error);
      return res.status(500).json({
        code: "UPLOAD_FAILED",
        message: "Unable to upload that profile picture right now.",
      });
    }
  }
);

export default router;
