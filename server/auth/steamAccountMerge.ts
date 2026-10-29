import { ObjectId } from "mongodb";
import mongoose from "mongoose";
import { invalidatePlayerProfile } from "../cache/playerIdentityCache";
import GameAccount, { type IGameAccount } from "../models/GameAccount";
import { betterAuthIdFilter } from "./betterAuthIds";
import { SteamAccountError } from "./steamAccount";

const conflict = (message: string) => new SteamAccountError(409, "STEAM_LINK_CONFLICT", message);

/** Replace stored tournament identities without changing dates or MongoDB IDs. */
function replaceIdentity(value: unknown, source: string, target: string, field = ""): unknown {
  if (
    value === source &&
    [
      "playerId",
      "creatorId",
      "winner",
      "participantIds",
      "invitedUserIds",
      "playerColors",
    ].includes(field)
  )
    return target;
  if (Array.isArray(value))
    return value.map((item) => replaceIdentity(item, source, target, field));
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype)
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceIdentity(item, source, target, key)]),
    );
  return value;
}

export async function finishSteamAccountMerge(steamId: string, targetId: string) {
  const db = mongoose.connection.getClient().db();
  const journal = db.collection("steamAccountLinks");
  const pending = await journal.findOne({ steamId, targetId, completedAt: { $exists: false } });
  if (!pending) return;
  const provider = await db
    .collection("account")
    .findOne({ providerId: "steam", accountId: steamId, userId: betterAuthIdFilter(targetId)! });
  if (!provider) throw conflict("Finish linking your existing account to continue.");
  const sourceKey = pending._id;
  await db.collection("achievements").deleteMany({ playerId: sourceKey });
  await db
    .collection<{ _id: ObjectId | string }>("user")
    .deleteOne({ _id: betterAuthIdFilter(String(sourceKey))! });
  await GameAccount.deleteOne({ _id: sourceKey, steamLinkTargetId: targetId });
  await db
    .collection("gameaccounts")
    .updateOne({ _id: new ObjectId(targetId) }, { $unset: { mergedSteamSources: 1 } });
  await journal.deleteOne({ _id: sourceKey });
  invalidatePlayerProfile(String(sourceKey));
  invalidatePlayerProfile(targetId);
}

/**
 * Only automatic, Steam-only identities can be joined. The caller must prove
 * both the active Steam identity and the destination web login.
 *
 * A durable journal and additive/idempotent writes allow retries on standalone
 * MongoDB as well as replica sets. The source is disabled before moving data;
 * the Steam provider moves last, so an interrupted run cannot mint a partially
 * migrated login. Until completion the journal binds this source to one destination.
 */
export async function mergeSteamAccount(steamId: string, sourceId: string, targetId: string) {
  const db = mongoose.connection.getClient().db();
  const sourceKey = new ObjectId(sourceId),
    targetKey = new ObjectId(targetId);
  const [source, target, user, sourceUser, providers] = await Promise.all([
    GameAccount.findById(sourceId).lean<IGameAccount>(),
    GameAccount.findById(targetId).lean<IGameAccount>(),
    db
      .collection<{ _id: ObjectId | string; isAnonymous?: boolean; banned?: boolean }>("user")
      .findOne({ _id: betterAuthIdFilter(targetId)! }),
    db
      .collection<{ _id: ObjectId | string; banned?: boolean; role?: string }>("user")
      .findOne({ _id: betterAuthIdFilter(sourceId)! }),
    db
      .collection("account")
      .find({ userId: betterAuthIdFilter(sourceId)! })
      .toArray(),
  ]);
  if (
    !source?.steamAutoCreated ||
    !sourceUser ||
    sourceUser.banned ||
    sourceUser.role === "admin" ||
    !target ||
    !user ||
    user.isAnonymous ||
    user.banned ||
    (target.steamId && target.steamId !== steamId) ||
    target.steamLinkTargetId ||
    source.isAdmin ||
    providers.some((row) => row.providerId !== "steam") ||
    (source.steamLinkTargetId && source.steamLinkTargetId !== targetId)
  )
    throw conflict("Steam or this Tiao account already has another login linked.");
  // A native Steam identity has no external billing credentials to transfer.
  if (
    source.stripeCustomerId ||
    source.appStoreAccountToken ||
    source.googlePlayAccountId ||
    source.activeSubscriptions?.length
  )
    throw conflict("This account has other billing methods. Keep using its existing login.");

  const journal = db.collection("steamAccountLinks");
  const previous = await journal.findOne({ _id: sourceKey });
  if (previous && previous.targetId !== targetId)
    throw conflict("Steam is already being linked to another account.");
  const involved = [sourceId, targetId];
  const tournamentQuery = {
    $or: [
      { "participants.playerId": { $in: involved } },
      { creatorId: { $in: involved } },
      { invitedUserIds: { $in: involved } },
    ],
  };
  const { gameService } = await import("../game/gameService");
  const [busyGame, busyTournament, pendingPurchase, pendingExport, sourceSearch, targetSearch] =
    await Promise.all([
      db.collection("gamerooms").findOne({
        $or: [
          { "seats.white.playerId": { $in: involved } },
          { "seats.black.playerId": { $in: involved } },
        ],
        $and: [{ $or: [{ status: { $ne: "finished" } }, { ratingStatus: "pending" }] }],
      }),
      db.collection("tournaments").findOne({
        ...tournamentQuery,
        $and: [
          {
            $or: [
              { status: { $nin: ["finished", "cancelled"] } },
              { completionEffectsPending: true },
              { cleanupPending: true },
            ],
          },
        ],
        deletedAt: null,
      }),
      db.collection("storepurchases").findOne({ playerId: sourceId, status: "pending" }),
      db
        .collection("userexportrequests")
        .findOne({ accountId: sourceId, status: { $in: ["pending", "running"] } }),
      gameService.getMatchmakingState({
        playerId: sourceId,
        displayName: source.displayName,
        kind: "account",
      }),
      gameService.getMatchmakingState({
        playerId: targetId,
        displayName: target.displayName,
        kind: "account",
      }),
    ]);
  if (
    busyGame ||
    busyTournament ||
    pendingPurchase ||
    pendingExport ||
    sourceSearch.status === "searching" ||
    targetSearch.status === "searching"
  )
    throw new SteamAccountError(
      409,
      "STEAM_LINK_BUSY",
      "Leave matchmaking and finish games, tournaments, purchases and data exports, then try linking again.",
    );
  const tournaments = await db.collection("tournaments").find(tournamentQuery).toArray();
  if (
    tournaments.some((t) => {
      const players = (t.participants ?? []) as Array<{ playerId: string }>;
      return (
        players.some((p) => p.playerId === sourceId) && players.some((p) => p.playerId === targetId)
      );
    })
  )
    throw conflict(
      "These accounts played in the same tournament. They cannot be joined automatically.",
    );

  // Reserve the destination before changing the source. A competing Steam
  // identity must not write any data into this account.
  await journal.updateOne(
    { _id: sourceKey },
    { $setOnInsert: { targetId, steamId, createdAt: new Date() } },
    { upsert: true },
  );
  if ((await journal.findOne({ _id: sourceKey }))?.targetId !== targetId)
    throw conflict("Steam is already being linked to another account.");
  const reserved = await GameAccount.updateOne(
    {
      _id: targetKey,
      $and: [{ $or: [{ steamId: { $exists: false } }, { steamId }] }],
      $or: [{ steamLinkSourceId: { $exists: false } }, { steamLinkSourceId: sourceId }],
    },
    { $set: { steamLinkSourceId: sourceId } },
    { strict: false },
  );
  if (!reserved.matchedCount)
    throw conflict("This account is already linking another Steam identity.");
  await GameAccount.updateOne({ _id: sourceKey }, { $set: { steamLinkTargetId: targetId } });
  await db.collection("session").deleteMany({ userId: betterAuthIdFilter(sourceId)! });
  await db.collection("desktopSessions").deleteMany({ userId: sourceId });
  await db.collection("gamesessions").deleteMany({ playerId: sourceId });

  // One atomic account update: retries must not add played games or reports twice.
  await db
    .collection("gameaccounts")
    .updateOne({ _id: targetKey, mergedSteamSources: { $ne: sourceId } }, [
      {
        $set: {
          badges: { $setUnion: [{ $ifNull: ["$badges", []] }, { $literal: source.badges ?? [] }] },
          unlockedThemes: {
            $setUnion: [
              { $ifNull: ["$unlockedThemes", []] },
              { $literal: source.unlockedThemes ?? [] },
            ],
          },
          friends: {
            $setDifference: [
              { $setUnion: [{ $ifNull: ["$friends", []] }, { $literal: source.friends ?? [] }] },
              [sourceKey, targetKey],
            ],
          },
          receivedFriendRequests: {
            $setDifference: [
              {
                $setUnion: [
                  { $ifNull: ["$receivedFriendRequests", []] },
                  { $literal: source.receivedFriendRequests ?? [] },
                ],
              },
              [sourceKey, targetKey],
            ],
          },
          sentFriendRequests: {
            $setDifference: [
              {
                $setUnion: [
                  { $ifNull: ["$sentFriendRequests", []] },
                  { $literal: source.sentFriendRequests ?? [] },
                ],
              },
              [sourceKey, targetKey],
            ],
          },
          hasSeenTutorial: { $or: ["$hasSeenTutorial", !!source.hasSeenTutorial] },
          flaggedForReview: { $or: ["$flaggedForReview", !!source.flaggedForReview] },
          reportCount: { $add: [{ $ifNull: ["$reportCount", 0] }, source.reportCount ?? 0] },
          "rating.overall.elo": {
            $cond: [
              { $gt: ["$rating.overall.gamesPlayed", 0] },
              "$rating.overall.elo",
              source.rating?.overall?.elo ?? 1500,
            ],
          },
          "rating.overall.gamesPlayed": {
            $add: [
              { $ifNull: ["$rating.overall.gamesPlayed", 0] },
              source.rating?.overall?.gamesPlayed ?? 0,
            ],
          },
          mergedSteamSources: { $setUnion: [{ $ifNull: ["$mergedSteamSources", []] }, [sourceId]] },
        },
      },
    ]);
  for (const achievement of await db
    .collection("achievements")
    .find({ playerId: sourceKey })
    .toArray()) {
    await db.collection("achievements").updateOne(
      { playerId: targetKey, achievementId: achievement.achievementId },
      {
        $min: { unlockedAt: achievement.unlockedAt },
        $setOnInsert: { playerId: targetKey, achievementId: achievement.achievementId },
      },
      { upsert: true },
    );
  }
  for (const color of ["white", "black"])
    await db.collection("gamerooms").updateMany(
      { [`seats.${color}.playerId`]: sourceId },
      {
        $set: {
          [`seats.${color}.playerId`]: targetId,
          [`seats.${color}.displayName`]: target.displayName,
          [`seats.${color}.kind`]: "account",
        },
      },
    );
  for (const field of ["friends", "receivedFriendRequests", "sentFriendRequests"]) {
    await db
      .collection("gameaccounts")
      .updateMany({ [field]: sourceKey, _id: { $nin: [sourceKey, targetKey] } }, [
        {
          $set: {
            [field]: { $setUnion: [{ $setDifference: [`$${field}`, [sourceKey]] }, [targetKey]] },
          },
        },
      ]);
  }
  for (const [collection, fields] of [
    ["gameinvitations", ["senderId", "recipientId"]],
    ["playerreports", ["reporterId", "reportedId"]],
  ] as const)
    for (const field of fields)
      await db
        .collection(collection)
        .updateMany({ [field]: sourceKey }, { $set: { [field]: targetKey } });
  await db
    .collection("gameinvitations")
    .updateMany(
      { senderId: targetKey, recipientId: targetKey, status: "pending" },
      { $set: { status: "revoked" } },
    );
  await db
    .collection("storepurchases")
    .updateMany({ playerId: sourceId }, { $set: { playerId: targetId } });
  await db
    .collection("userexportrequests")
    .updateMany({ accountId: sourceId }, { $set: { accountId: targetId } });
  for (const tournament of tournaments) {
    const next = replaceIdentity(tournament, sourceId, targetId) as typeof tournament;
    const { _id, ...fields } = next;
    const updated = await db
      .collection("tournaments")
      .updateOne({ _id, revision: tournament.revision }, { $set: fields });
    if (!updated.matchedCount)
      throw new SteamAccountError(
        409,
        "STEAM_LINK_BUSY",
        "Tournament history changed while linking. Please try again.",
      );
  }
  for (const match of await db
    .collection("tournamentmatches")
    .find({ "players.playerId": sourceId })
    .toArray()) {
    const { _id, ...fields } = replaceIdentity(match, sourceId, targetId) as typeof match;
    await db.collection("tournamentmatches").updateOne({ _id }, { $set: fields });
  }
  // Keep a complete source until every data move has succeeded. Removing its
  // unique steamId is safe now: the provider still reserves the verified identity.
  await GameAccount.updateOne({ _id: sourceKey }, { $unset: { steamId: 1 } });
  await GameAccount.updateOne(
    { _id: targetKey },
    { $set: { steamId, steamProviderLinked: true }, $unset: { steamLinkSourceId: 1 } },
    { strict: false },
  );
  const moved = await db
    .collection("account")
    .updateOne(
      { providerId: "steam", accountId: steamId, userId: betterAuthIdFilter(sourceId)! },
      { $set: { userId: targetKey, updatedAt: new Date() } },
    );
  if (!moved.matchedCount)
    throw conflict("Steam linking was interrupted. Sign in again to finish.");
  await finishSteamAccountMerge(steamId, targetId);
}
