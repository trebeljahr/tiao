import { ObjectId } from "mongodb";
import mongoose from "mongoose";
import { isValidUsername } from "../../shared/src";
import { getRedisClient } from "../config/redisClient";
import { InMemoryLockProvider, RedisLockProvider } from "../game/lockProvider";
import GameAccount from "../models/GameAccount";
import { SteamMicroTxnClient } from "../payments/steamMicroTxn";
import { auth } from "./auth";
import { createSessionToken } from "./desktopSessionManager";
import { desktopSessionStore } from "./desktopSessionStore";
import { finishSteamAccountMerge, mergeSteamAccount } from "./steamAccountMerge";
import { fetchSteamProfile, type SteamProfile } from "./steamProfile";

export const STEAM_AUTH_IDENTITY = "tiao-auth";
const localSteamLocks = new InMemoryLockProvider();
function withSteamLock<T>(steamId: string, operation: () => Promise<T>) {
  const redis = getRedisClient();
  return (redis ? new RedisLockProvider(redis) : localSteamLocks).withLock(
    `steam-account:${steamId}`,
    operation,
  );
}

export { publicAccountEmail } from "./steamEmail";

import { STEAM_EMAIL_DOMAIN } from "./steamEmail";

export class SteamAccountError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function steamAuthAppIds(env: NodeJS.ProcessEnv = process.env): number[] {
  // Full game and demo share accounts, but each ticket must be checked against
  // the AppID that minted it. A client cannot introduce another publisher's app.
  return (env.STEAM_AUTH_APP_IDS ?? "5035580,5491870")
    .split(",")
    .map(Number)
    .filter((id) => Number.isSafeInteger(id) && id > 0);
}

export async function verifySteamAuthTicket(ticket: unknown, appId: unknown): Promise<string> {
  if (
    typeof ticket !== "string" ||
    !/^(?:[a-f0-9]{2}){1,4096}$/i.test(ticket) ||
    typeof appId !== "number" ||
    !steamAuthAppIds().includes(appId)
  )
    throw new SteamAccountError(400, "INVALID_STEAM_TICKET", "Invalid Steam sign-in request.");
  const publisherKey = process.env.STEAM_PUBLISHER_WEB_API_KEY;
  if (!publisherKey)
    throw new SteamAccountError(
      503,
      "STEAM_AUTH_UNAVAILABLE",
      "Steam sign-in is not configured yet.",
    );
  try {
    const owner = await new SteamMicroTxnClient({
      publisherKey,
      appId,
      sandbox: false,
      fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10000) }),
    }).authenticateUserTicket(ticket, STEAM_AUTH_IDENTITY);
    if (!/^\d{17}$/.test(owner.steamId) || owner.publisherBanned)
      throw new Error("Rejected identity");
    // Family sharing identifies the player, never the library owner.
    return owner.steamId;
  } catch {
    throw new SteamAccountError(
      401,
      "INVALID_STEAM_TICKET",
      "Steam could not verify your sign-in. Please try again.",
    );
  }
}

let indexReady: Promise<unknown> | undefined;
function accounts() {
  return mongoose.connection.getClient().db().collection("account");
}

async function ensureSteamIndex() {
  indexReady ??= Promise.all([
    GameAccount.collection.createIndex({ steamId: 1 }, { unique: true, sparse: true }),
    accounts().createIndex(
      { providerId: 1, accountId: 1 },
      { unique: true, partialFilterExpression: { providerId: "steam" } },
    ),
    accounts().createIndex(
      { providerId: 1, userId: 1 },
      { unique: true, partialFilterExpression: { providerId: "steam" } },
    ),
  ]).catch((error: unknown) => {
    indexReady = undefined;
    throw error;
  });
  await indexReady;
}

async function provisionSteamUser(account: {
  id: string;
  displayName: string;
  steamId?: string;
  profilePicture?: string;
}) {
  if (!account.steamId) throw new Error("Missing verified Steam identity");
  const db = mongoose.connection.getClient().db();
  // Upsert by the reserved game account ID so a retry can finish an interrupted
  // signup without creating another identity or touching an existing web user.
  await db.collection("user").updateOne(
    { _id: new ObjectId(account.id) },
    {
      $setOnInsert: {
        name: account.displayName,
        displayName: account.displayName,
        email: `${account.steamId}@${STEAM_EMAIL_DOMAIN}`,
        emailVerified: false,
        isAnonymous: false,
        image: account.profilePicture || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
}

/** Steam is a normal Better Auth account provider, shared by browser and SDK login. */
async function provisionSteamProvider(steamId: string, userId: string) {
  await ensureSteamIndex();
  const owner = await accounts().findOne({ providerId: "steam", accountId: steamId });
  if (owner && String(owner.userId) !== userId) throw linkConflict();
  await accounts().updateOne(
    { providerId: "steam", accountId: steamId },
    {
      $setOnInsert: {
        providerId: "steam",
        accountId: steamId,
        userId: new ObjectId(userId),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
  await GameAccount.updateOne({ _id: userId, steamId }, { $set: { steamProviderLinked: true } });
}
function linkConflict() {
  return new SteamAccountError(
    409,
    "STEAM_LINK_CONFLICT",
    "Steam or this Tiao account is already linked. Sign in to the linked account to keep your progress.",
  );
}

export async function findSteamAccount(steamId: string) {
  const provider = await accounts().findOne({ providerId: "steam", accountId: steamId });
  // Normal lookups never recreate a deleted provider or user. Only legacy
  // links that predate provider records need an idempotent backfill.
  if (provider) {
    const account = await GameAccount.findById(provider.userId);
    if (account?.steamLinkTargetId)
      throw new SteamAccountError(
        409,
        "STEAM_LINK_IN_PROGRESS",
        "Finish linking your existing account to continue.",
      );
    if (account) await finishSteamAccountMerge(steamId, account.id);
    return account;
  }
  const account = await GameAccount.findOne({ steamId, steamProviderLinked: { $ne: true } });
  if (account) {
    await provisionSteamUser(account);
    await provisionSteamProvider(steamId, account.id);
  }
  return account;
}

/** Each write is idempotent, including recovery after a partially completed signup. */
export async function createSteamAccount(
  steamId: string,
  username: unknown,
  profile?: SteamProfile,
  automatic = false,
) {
  if (typeof username !== "string" || !isValidUsername(username)) {
    throw new SteamAccountError(
      400,
      "INVALID_USERNAME",
      "Choose a username with 3–32 lowercase letters, numbers, hyphens or underscores.",
    );
  }
  await ensureSteamIndex();
  const linked = await findSteamAccount(steamId);
  if (linked) return linked;
  const defaults = profile ?? (await fetchSteamProfile(steamId));
  let account: {
    id: string;
    displayName: string;
    steamId?: string;
    profilePicture?: string;
  } | null = null;
  try {
    account = await GameAccount.findOneAndUpdate(
      { steamId, steamProviderLinked: { $ne: true } },
      {
        $setOnInsert: {
          steamId,
          ...(automatic ? { steamAutoCreated: true } : {}),
          displayName: username,
          ...(defaults.avatarUrl ? { profilePicture: defaults.avatarUrl } : {}),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === 11000))
      throw error;
    account = await findSteamAccount(steamId);
    if (!account)
      throw new SteamAccountError(409, "DUPLICATE_USERNAME", "That username is already taken.");
  }
  if (!account) throw new Error("Could not create Steam account");
  await provisionSteamUser(account);
  await provisionSteamProvider(steamId, account.id);
  return account;
}

/** Native Steam players start playing immediately, even when names collide. */
export async function ensureSteamAccount(steamId: string) {
  return withSteamLock(steamId, async () => {
    let linked;
    try {
      linked = await findSteamAccount(steamId);
    } catch (error) {
      if (!(error instanceof SteamAccountError) || error.code !== "STEAM_LINK_IN_PROGRESS")
        throw error;
      // Both proofs and the named confirmation preceded this durable binding.
      // A fresh ticket for the same Steam player can safely finish that exact
      // migration even if its old sessions were revoked or the app restarted.
      const provider = await accounts().findOne({ providerId: "steam", accountId: steamId });
      const pending =
        provider &&
        (await mongoose.connection
          .getClient()
          .db()
          .collection("steamAccountLinks")
          .findOne({ _id: new ObjectId(String(provider.userId)), steamId }));
      if (!provider || !pending || typeof pending.targetId !== "string") throw error;
      await mergeSteamAccount(steamId, String(provider.userId), pending.targetId);
      linked = await findSteamAccount(steamId);
    }
    if (linked) return linked;
    const profile = await fetchSteamProfile(steamId);
    const base = profile.suggestedUsername || "steam-player";
    for (let attempt = 0; attempt < 8; attempt++) {
      const suffix =
        attempt === 0 ? "" : `-${steamId.slice(-6)}${attempt === 1 ? "" : `-${attempt}`}`;
      try {
        return await createSteamAccount(
          steamId,
          `${base.slice(0, 32 - suffix.length)}${suffix}`,
          profile,
          true,
        );
      } catch (error) {
        if (!(error instanceof SteamAccountError) || error.code !== "DUPLICATE_USERNAME")
          throw error;
      }
    }
    // The full verified SteamID also gives a stable fallback for adversarial name collisions.
    return createSteamAccount(steamId, `steam-${steamId}`, profile, true);
  });
}

export async function linkSteamAccount(steamId: string, userId: string) {
  return withSteamLock(steamId, async () => {
    await ensureSteamIndex();
    // Read the provider directly so the same verified pair can resume a partial migration.
    const provider = await accounts().findOne({ providerId: "steam", accountId: steamId });
    const owner = provider
      ? await GameAccount.findById(provider.userId)
      : await findSteamAccount(steamId);
    if (owner?.id === userId) await finishSteamAccountMerge(steamId, userId);
    if (owner && owner.id !== userId) {
      if (!owner.steamAutoCreated) throw linkConflict();
      await mergeSteamAccount(steamId, owner.id, userId);
      return GameAccount.findById(userId);
    }
    try {
      const account = await GameAccount.findOneAndUpdate(
        {
          _id: userId,
          steamLinkSourceId: { $exists: false },
          $or: [{ steamId: { $exists: false } }, { steamId }],
        },
        { $set: { steamId } },
        { new: true },
      );
      if (account) {
        await provisionSteamProvider(steamId, account.id);
        return account;
      }
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === 11000))
        throw error;
    }
    throw new SteamAccountError(
      409,
      "STEAM_LINK_CONFLICT",
      "Steam or this Tiao account is already linked. Sign in to the linked account to keep your progress.",
    );
  });
}

export async function mintSteamDesktopSession(userId: string) {
  const ctx = await auth.$context;
  const session = await ctx.internalAdapter.createSession(userId);
  const securityState = await desktopSessionStore.securityState(userId, session.id);
  if (!securityState)
    throw new SteamAccountError(401, "ACCOUNT_UNAVAILABLE", "This account is unavailable.");
  const sessionToken = await createSessionToken(userId, session.id, securityState);
  return { sessionToken, userId };
}
