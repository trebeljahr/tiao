import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { anonymous } from "better-auth/plugins";
import { APIError } from "better-auth/api";
import bcrypt from "bcrypt";
import { MongoClient } from "mongodb";
import GameAccount from "../models/GameAccount";
import { generateFunAnonymousName } from "../game/playerTokens";
import { FRONTEND_URL, MONGODB_URI, TOKEN_SECRET, PORT } from "../config/envVars";
import { sendPasswordResetEmail, sendVerificationEmail } from "./email";
import { identify, track } from "../analytics/openpanel";

const SALT_ROUNDS = 10;

// Use a standalone MongoClient for better-auth — Mongoose's connection isn't
// ready at module load time, but better-auth needs a client immediately.
const mongoClient = new MongoClient(MONGODB_URI);

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || FRONTEND_URL || `http://localhost:${PORT}`,
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
      await sendPasswordResetEmail(user.email, url);
      track("password_reset_requested", { profileId: user.id });
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendVerificationEmail(user.email, url);
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

  account: {
    accountLinking: {
      enabled: true,
      // Allow linking SSO providers that use a different email than the
      // password-based account.  SSO emails live in their own namespace
      // inside better-auth's `account` collection, so there is no
      // collision with password-based emails.
      allowDifferentEmails: true,
      // NEVER auto-link accounts just because the emails match.
      // Linking must always be an explicit user action via linkSocial().
      disableImplicitLinking: true,
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

  onAPIError: {
    // Fallback error URL for API errors that aren't OAuth-flow errors.
    // OAuth sign-in / linkSocial calls pass their own `errorCallbackURL`
    // pointing back at the page that initiated the flow, and OAuthErrorHandler
    // in providers.tsx surfaces `?error=` as a toast in-place — the user
    // never has to leave the page they were on.
    errorURL: FRONTEND_URL || "http://localhost:3000",
  },

  advanced: {
    cookiePrefix: "tiao",
  },

  trustedOrigins: (request) => {
    const origins: string[] = [];
    if (FRONTEND_URL) origins.push(FRONTEND_URL);
    // In dev, allow localhost and LAN IPs
    if (process.env.NODE_ENV !== "production") {
      const origin = request?.headers.get("origin");
      if (
        origin &&
        (/localhost/.test(origin) ||
          /^https?:\/\/(127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(origin))
      ) {
        origins.push(origin);
      }
    }
    return origins;
  },

  databaseHooks: {
    session: {
      create: {
        after: async (session) => {
          // Sync SSO profile picture → GameAccount on every login.
          // better-auth stores the SSO avatar in user.image; we keep
          // GameAccount.profilePicture as the single source of truth for
          // all downstream features (social, games, tournaments).
          // Only overwrite when the user hasn't uploaded a custom picture
          // (custom uploads go through CloudFront, SSO images are external URLs).
          try {
            const db = (await import("mongoose")).default.connection.getClient().db();
            const baUser = await db.collection("user").findOne({ _id: session.userId as any });

            // Anonymous guests intentionally have no GameAccount — they're
            // ephemeral and live only in the BA user/session collections.
            // Skip the orphaned-cleanup branch for them, otherwise signing
            // in anonymously (e.g. right after logout) would immediately
            // delete the freshly-created guest and leave the reloaded page
            // without a session.
            if (baUser?.isAnonymous) return;

            const account = await GameAccount.findById(session.userId);
            if (!account) {
              // Orphaned BA user — GameAccount was deleted but BA records linger.
              // Clean up so the email is freed for re-registration.
              try {
                await db.collection("session").deleteMany({ userId: session.userId } as any);
                await db.collection("account").deleteMany({ userId: session.userId } as any);
                await db.collection("user").deleteOne({ _id: session.userId as any });
                // Orphaned BA records cleaned up for deleted user
              } catch (cleanupErr) {
                console.warn("[auth] Failed to clean up orphaned BA records:", cleanupErr);
              }
              return;
            }

            // If the user already has a custom-uploaded picture, don't overwrite
            if (account.profilePicture && account.profilePicture.includes("cloudfront")) return;

            const ssoImage = baUser?.image as string | null | undefined;

            if (ssoImage && ssoImage !== account.profilePicture) {
              account.profilePicture = ssoImage;
              await account.save();
            }
          } catch (err) {
            // Non-critical — log and continue so login isn't blocked
            console.warn("[auth] Failed to sync SSO profile picture:", err);
          }
        },
      },
    },
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

          // Skip if a GameAccount already exists (e.g. OAuth linking to existing account)
          const existing = await GameAccount.findById(user.id);
          if (existing) return;

          const displayName =
            (user.displayName as string | undefined) ||
            user.name ||
            user.email?.split("@")[0] ||
            `player-${user.id.slice(0, 8)}`;

          try {
            await GameAccount.create({
              _id: user.id,
              displayName,
              profilePicture: user.image || undefined,
            });
          } catch (err: unknown) {
            // Duplicate key on displayName is fine — generate a unique fallback
            if (err instanceof Error && "code" in err && (err as { code: number }).code === 11000) {
              await GameAccount.create({
                _id: user.id,
                displayName: `${displayName}-${user.id.slice(0, 6)}`,
                profilePicture: user.image || undefined,
              });
            } else {
              throw err;
            }
          }

          // Authoritative signup event. Fire after the GameAccount exists so
          // downstream analytics can join on profileId without a race. Guests
          // bail earlier (isAnonymous short-circuit above) so this only
          // records real accounts — OAuth + email/password both land here.
          identify(user.id, {
            firstName: displayName,
            ...(user.email ? { email: user.email } : {}),
          });
          track("user_signed_up", {
            profileId: user.id,
            method: user.email ? "email" : "oauth",
          });
        },
      },
    },
  },

  plugins: [
    anonymous({
      generateName: () => {
        const name = generateFunAnonymousName();
        return name;
      },
      onLinkAccount: async ({ anonymousUser, newUser }) => {
        // Migrate guest games to the real account for BOTH sign-up and
        // sign-in flows. Previously sign-in silently discarded the guest's
        // games, which meant a player mid-game as a guest lost the game the
        // moment they logged in. Now we migrate per-room, and if the guest
        // was playing against the *same* account they're signing into,
        // gameService deletes the room and notifies all open sockets so
        // nothing gets left in a "you vs. yourself" state.
        const guestId = anonymousUser.user.id;
        const newId = newUser.user.id;
        const newDisplayName =
          (newUser.user as { displayName?: string }).displayName || newUser.user.name;
        const { gameService } = await import("../game/gameService");
        try {
          const result = await gameService.migrateGuestToAccount(guestId, {
            playerId: newId,
            displayName: newDisplayName,
            kind: "account",
          });
          track("guest_upgraded", {
            profileId: newId,
            guest_id: guestId,
            migrated_games: result.migrated,
            dropped_games: result.deleted,
          });
        } catch (err) {
          console.error("[auth] Guest game migration failed:", err);
        }
      },
    }),
  ],
});

export type BetterAuthSession = typeof auth.$Infer.Session;
