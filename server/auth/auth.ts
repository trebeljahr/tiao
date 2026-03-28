import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { anonymous } from "better-auth/plugins";
import { APIError } from "better-auth/api";
import bcrypt from "bcrypt";
import { MongoClient } from "mongodb";
import mongoose from "mongoose";
import GameAccount from "../models/GameAccount";
import GameRoom from "../models/GameRoom";
import { generateFunAnonymousName } from "../game/playerTokens";
import { FRONTEND_URL, MONGODB_URI, TOKEN_SECRET, PORT } from "../config/envVars";

const SALT_ROUNDS = 10;

// Use a standalone MongoClient for better-auth — Mongoose's connection isn't
// ready at module load time, but better-auth needs a client immediately.
const mongoClient = new MongoClient(MONGODB_URI);

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || `http://localhost:${PORT}`,
  basePath: "/api/auth",
  secret: process.env.BETTER_AUTH_SECRET || TOKEN_SECRET,

  database: mongodbAdapter(mongoClient.db()),

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    password: {
      hash: (password) => bcrypt.hash(password, SALT_ROUNDS),
      verify: ({ hash, password }) => bcrypt.compare(password, hash),
    },
    sendResetPassword: async ({ user, url }) => {
      // TODO: integrate Resend email service
      console.info(`[auth] Password reset requested for ${user.email}: ${url}`);
    },
  },

  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      // TODO: integrate Resend email service
      console.info(`[auth] Verification email for ${user.email}: ${url}`);
    },
  },

  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID || "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
      enabled: !!process.env.GITHUB_CLIENT_ID,
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      enabled: !!process.env.GOOGLE_CLIENT_ID,
    },
    discord: {
      clientId: process.env.DISCORD_CLIENT_ID || "",
      clientSecret: process.env.DISCORD_CLIENT_SECRET || "",
      enabled: !!process.env.DISCORD_CLIENT_ID,
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh after 1 day of activity
  },

  user: {
    additionalFields: {
      displayName: {
        type: "string",
        required: false,
      },
    },
  },

  advanced: {
    cookiePrefix: "tiao",
  },

  trustedOrigins: FRONTEND_URL
    ? [FRONTEND_URL]
    : ["http://localhost:3000", "http://localhost:5173"],

  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          // Validate displayName if provided (signup via email/password)
          const displayName = (user.displayName as string | undefined)?.trim().toLowerCase();

          if (displayName) {
            if (displayName.length < 3 || displayName.length > 32) {
              throw new APIError("BAD_REQUEST", {
                message: "Usernames must be between 3 and 32 characters.",
              });
            }

            if (!/^[a-z0-9][a-z0-9_-]*$/.test(displayName)) {
              throw new APIError("BAD_REQUEST", {
                message:
                  "Usernames must be lowercase and can only contain letters, numbers, hyphens, and underscores.",
              });
            }

            const existing = await GameAccount.findOne({ displayName });
            if (existing) {
              throw new APIError("BAD_REQUEST", {
                message: "That username is already taken.",
              });
            }

            return { data: { ...user, displayName, name: displayName } };
          }

          return { data: user };
        },
        after: async (user) => {
          // Don't create a GameAccount for anonymous users — they're ephemeral
          if (user.isAnonymous) return;

          const displayName =
            (user.displayName as string | undefined) ||
            user.name ||
            user.email?.split("@")[0] ||
            `player-${user.id.slice(0, 8)}`;

          await GameAccount.create({
            _id: user.id,
            displayName,
          });
        },
      },
    },
  },

  plugins: [
    anonymous({
      generateName: () => {
        const name = generateFunAnonymousName();
        console.info(`[auth] Generated anonymous name: ${name}`);
        return name;
      },
      onLinkAccount: async ({ anonymousUser, newUser }) => {
        // Migrate guest's in-progress games to the new account
        const guestId = anonymousUser.user.id;
        const newId = newUser.user.id;
        const newDisplayName =
          (newUser.user as any).displayName || newUser.user.name;

        await GameRoom.updateMany(
          {
            status: { $in: ["waiting", "active"] },
            "players.playerId": guestId,
          },
          {
            $set: {
              "players.$[p].playerId": newId,
              "players.$[p].displayName": newDisplayName,
              "players.$[p].kind": "account",
            },
          },
          { arrayFilters: [{ "p.playerId": guestId }] },
        );
        await GameRoom.updateMany(
          {
            status: { $in: ["waiting", "active"] },
            "seats.white.playerId": guestId,
          },
          {
            $set: {
              "seats.white.playerId": newId,
              "seats.white.displayName": newDisplayName,
              "seats.white.kind": "account",
            },
          },
        );
        await GameRoom.updateMany(
          {
            status: { $in: ["waiting", "active"] },
            "seats.black.playerId": guestId,
          },
          {
            $set: {
              "seats.black.playerId": newId,
              "seats.black.displayName": newDisplayName,
              "seats.black.kind": "account",
            },
          },
        );
      },
    }),
  ],
});

export type BetterAuthSession = typeof auth.$Infer.Session;
