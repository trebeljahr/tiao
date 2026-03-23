import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import express, { Request, Response } from "express";
import { Jimp } from "jimp";
import mongoose from "mongoose";
import GameAccount from "../models/GameAccount";
import {
  createAccountAuth,
  createGuestAuth,
  deriveDisplayNameFromEmail,
  getPlayerFromRequest,
  sanitizeDisplayName,
} from "../game/playerTokens";
import { BUCKET_NAME, CLOUDFRONT_URL } from "../config/envVars";
import { s3Client } from "../config/s3Client";
import { multerUploadMiddleware } from "../middleware/multerUploadMiddleware";

const router = express.Router();
const saltRounds = 10;

function isDatabaseReady(): boolean {
  return mongoose.connection.readyState === 1;
}

function buildAccountAuth(account: {
  id: string;
  email: string;
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
  email: string;
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
      message:
        "Account features are unavailable right now. You can still keep playing as a guest.",
    });
    return null;
  }

  const player = getPlayerFromRequest(req);
  if (!player) {
    res.status(401).json({
      message: "Not authenticated.",
    });
    return null;
  }

  if (player.kind !== "account") {
    res.status(403).json({
      message: "Only account players can edit a server profile.",
    });
    return null;
  }

  const account = await GameAccount.findById(player.playerId);
  if (!account) {
    res.status(404).json({
      message: "That account could not be found.",
    });
    return null;
  }

  return account;
}

router.post("/guest", (req: Request, res: Response) => {
  const { displayName } = req.body as {
    displayName?: string;
  };

  res.status(201).json(createGuestAuth(displayName));
});

router.post("/signup", async (req: Request, res: Response) => {
  if (!isDatabaseReady()) {
    return res.status(503).json({
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
  if (!normalizedEmail || !password) {
    return res.status(400).json({
      message: "Provide an email address and password.",
    });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!emailRegex.test(normalizedEmail)) {
    return res.status(400).json({
      message: "Provide a valid email address.",
    });
  }

  if (password.length < 8) {
    return res.status(400).json({
      message: "Passwords must be at least 8 characters long.",
    });
  }

  const existingAccount = await GameAccount.findOne({
    email: normalizedEmail,
  });

  if (existingAccount) {
    return res.status(409).json({
      message: "An account with that email already exists.",
    });
  }

  const passwordHash = bcrypt.hashSync(password, saltRounds);
  const account = await GameAccount.create({
    email: normalizedEmail,
    passwordHash,
    displayName: displayName?.trim() || deriveDisplayNameFromEmail(normalizedEmail),
  });

  return res.status(201).json(buildAccountAuth(account));
});

router.post("/login", async (req: Request, res: Response) => {
  if (!isDatabaseReady()) {
    return res.status(503).json({
      message:
        "Account login is unavailable right now. You can still keep playing as a guest.",
    });
  }

  const { email, password } = req.body as {
    email?: string;
    password?: string;
  };

  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail || !password) {
    return res.status(400).json({
      message: "Provide an email address and password.",
    });
  }

  const account = await GameAccount.findOne({
    email: normalizedEmail,
  });

  if (!account) {
    return res.status(401).json({
      message: "No account was found for that email address.",
    });
  }

  const passwordMatches = bcrypt.compareSync(password, account.passwordHash);
  if (!passwordMatches) {
    return res.status(401).json({
      message: "That password was incorrect.",
    });
  }

  return res.status(200).json(buildAccountAuth(account));
});

router.get("/me", async (req: Request, res: Response) => {
  const player = getPlayerFromRequest(req);
  if (!player) {
    return res.status(401).json({
      message: "Not authenticated.",
    });
  }

  if (player.kind === "account" && isDatabaseReady()) {
    const account = await GameAccount.findById(player.playerId);
    if (account) {
      return res.status(200).json({
        player: buildAccountAuth(account).player,
      });
    }
  }

  return res.status(200).json({ player });
});

router.get("/profile", async (req: Request, res: Response) => {
  const account = await requireAccount(req, res);
  if (!account) {
    return;
  }

  return res.status(200).json({
    profile: serializeAccountProfile(account),
  });
});

router.put("/profile", async (req: Request, res: Response) => {
  const account = await requireAccount(req, res);
  if (!account) {
    return;
  }

  const { displayName, email } = req.body as {
    displayName?: string;
    email?: string;
  };

  const normalizedEmail = email?.trim().toLowerCase();
  const sanitizedDisplayName = displayName?.trim();

  if (!normalizedEmail && !sanitizedDisplayName) {
    return res.status(400).json({
      message: "Provide a display name or email address to update.",
    });
  }

  if (sanitizedDisplayName !== undefined) {
    if (!sanitizedDisplayName) {
      return res.status(400).json({
        message: "Display name cannot be empty.",
      });
    }

    account.displayName = sanitizeDisplayName(sanitizedDisplayName);
  }

  if (normalizedEmail !== undefined) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({
        message: "Provide a valid email address.",
      });
    }

    const existingAccount = await GameAccount.findOne({
      email: normalizedEmail,
      _id: { $ne: account._id },
    });

    if (existingAccount) {
      return res.status(409).json({
        message: "An account with that email already exists.",
      });
    }

    account.email = normalizedEmail;
  }

  await account.save();

  return res.status(200).json({
    auth: buildAccountAuth(account),
    profile: serializeAccountProfile(account),
  });
});

router.post(
  "/profile-picture",
  multerUploadMiddleware.single("profilePicture"),
  async (req: Request, res: Response) => {
    const account = await requireAccount(req, res);
    if (!account) {
      return;
    }

    if (!req.file) {
      return res.status(400).json({
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

      return res.status(200).json({
        auth: buildAccountAuth(account),
        profile: serializeAccountProfile(account),
      });
    } catch (error) {
      console.error("Error uploading game account profile picture:", error);
      return res.status(500).json({
        message: "Unable to upload that profile picture right now.",
      });
    }
  }
);

export default router;
