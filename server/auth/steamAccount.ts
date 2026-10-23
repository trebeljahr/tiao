import { ObjectId } from "mongodb";
import mongoose from "mongoose";
import { isValidUsername } from "../../shared/src";
import GameAccount from "../models/GameAccount";
import { SteamMicroTxnClient } from "../payments/steamMicroTxn";
import { auth } from "./auth";
import { createSessionToken } from "./desktopSessionManager";
import { desktopSessionStore } from "./desktopSessionStore";

export const STEAM_AUTH_IDENTITY = "tiao-auth";
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
async function ensureSteamIndex() {
  indexReady ??= GameAccount.collection
    .createIndex({ steamId: 1 }, { unique: true, sparse: true })
    .catch((error: unknown) => {
      indexReady = undefined;
      throw error;
    });
  await indexReady;
}

async function provisionSteamUser(account: { id: string; displayName: string; steamId?: string }) {
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
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
}

export async function findSteamAccount(steamId: string) {
  const account = await GameAccount.findOne({ steamId });
  if (account) await provisionSteamUser(account);
  return account;
}

/** Each write is idempotent, including recovery after a partially completed signup. */
export async function createSteamAccount(steamId: string, username: unknown) {
  if (typeof username !== "string" || !isValidUsername(username)) {
    throw new SteamAccountError(
      400,
      "INVALID_USERNAME",
      "Choose a username with 3–32 lowercase letters, numbers, hyphens or underscores.",
    );
  }
  await ensureSteamIndex();
  let account: { id: string; displayName: string; steamId?: string } | null = null;
  try {
    account = await GameAccount.findOneAndUpdate(
      { steamId },
      { $setOnInsert: { steamId, displayName: username } },
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
  return account;
}

export async function linkSteamAccount(steamId: string, userId: string) {
  await ensureSteamIndex();
  try {
    const account = await GameAccount.findOneAndUpdate(
      { _id: userId, $or: [{ steamId: { $exists: false } }, { steamId }] },
      { $set: { steamId } },
      { new: true },
    );
    if (account) return account;
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === 11000))
      throw error;
  }
  throw new SteamAccountError(
    409,
    "STEAM_LINK_CONFLICT",
    "Steam or this Tiao account is already linked. Sign in to the linked account to keep your progress.",
  );
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
