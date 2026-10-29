import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import mongoose from "mongoose";

const DB_NAME = `tiao_test_steam_accounts_${process.pid}`;
process.env.TOKEN_SECRET = "steam-test-secret";
const mongoUrl = new URL(process.env.MONGODB_TEST_URI ?? "mongodb://127.0.0.1:27017");
assert.ok(
  ["127.0.0.1", "localhost", "[::1]"].includes(mongoUrl.hostname),
  "Use a local disposable MongoDB fixture",
);
mongoUrl.pathname = `/${DB_NAME}`;
process.env.MONGODB_URI = mongoUrl.toString();
process.env.S3_BUCKET_NAME = "test";
process.env.S3_PUBLIC_URL = "https://assets.test.local";
process.env.NODE_ENV = "test";

// Dynamic imports ensure Better Auth's adapter uses this isolated database.
let steam: typeof import("../../auth/steamAccount");
let GameAccount: typeof import("../../models/GameAccount").default;
let auth: typeof import("../../auth/auth").auth;
let verifySessionToken: typeof import("../../auth/desktopSessionManager").verifySessionToken;

before(async () => {
  await mongoose.connect(process.env.MONGODB_URI!, { serverSelectionTimeoutMS: 3000 });
  steam = await import("../../auth/steamAccount");
  GameAccount = (await import("../../models/GameAccount")).default;
  auth = (await import("../../auth/auth")).auth;
  verifySessionToken = (await import("../../auth/desktopSessionManager")).verifySessionToken;
  await GameAccount.init();
});
after(async () => {
  try {
    // Close Better Auth's separate pool before removing its database.
    if (auth) await (await import("../../auth/auth")).closeAuthDatabaseForTests();
    if (mongoose.connection.readyState === 1) {
      // Route imports can still be creating collections in the background.
      await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
      await mongoose.connection.dropDatabase();
    }
  } finally {
    await mongoose.disconnect();
  }
});

test("concurrent full-game/demo signups converge on one account and valid revocable sessions", async () => {
  const accounts = await Promise.all(
    Array.from({ length: 5 }, () => steam.createSteamAccount("76561198000000001", "steam-player")),
  );
  assert.equal(new Set(accounts.map((account) => account.id)).size, 1);
  assert.equal(await GameAccount.countDocuments({ steamId: "76561198000000001" }), 1);
  const userId = accounts[0].id;
  const token = await steam.mintSteamDesktopSession(userId);
  assert.equal((await verifySessionToken(token.sessionToken))?.userId, userId);
  const { auth: playerAuth } = await import("../../auth/auth");
  assert.ok(playerAuth);
  const { publicAccountEmail } = steam;
  assert.equal(publicAccountEmail("76561198000000001@steam.tiao.invalid"), undefined);
  assert.equal(publicAccountEmail("player@example.com"), "player@example.com");
});

test("native Steam signup is automatic, survives name collisions, and is stable across launches", async () => {
  await GameAccount.create({ displayName: "player-000050" });
  const results = await Promise.all(
    Array.from({ length: 4 }, () => steam.ensureSteamAccount("76561198000000050")),
  );
  assert.equal(new Set(results.map((row) => row.id)).size, 1);
  assert.equal(results[0].steamAutoCreated, true);
  assert.notEqual(results[0].displayName, "player-000050");
  assert.equal((await steam.ensureSteamAccount("76561198000000050")).id, results[0].id);
});

test("automatic Steam account joins a proven web account without losing progress or purchases", async () => {
  const db = mongoose.connection.getClient().db();
  const source = await steam.ensureSteamAccount("76561198000000051");
  const signup = await auth.api.signUpEmail({
    body: { email: "merge-web@example.com", name: "merge-web", password: "test-password-123" },
  });
  const targetId = String(signup.user.id),
    targetKey = new mongoose.Types.ObjectId(targetId);
  const friend = await GameAccount.create({ displayName: "merge-friend", friends: [source._id] });
  await GameAccount.updateOne(
    { _id: source._id },
    {
      $set: {
        badges: ["supporter"],
        unlockedThemes: ["ocean"],
        friends: [friend._id],
        rating: { overall: { elo: 1650, gamesPlayed: 8 } },
        hasSeenTutorial: true,
      },
    },
  );
  await GameAccount.updateOne(
    { _id: targetId },
    { $set: { badges: ["web-badge"], rating: { overall: { elo: 1700, gamesPlayed: 12 } } } },
  );
  await db.collection("achievements").insertMany([
    { playerId: source._id, achievementId: "first-win", unlockedAt: new Date(1000) },
    { playerId: targetKey, achievementId: "first-win", unlockedAt: new Date(2000) },
    { playerId: source._id, achievementId: "steam-only", unlockedAt: new Date(3000) },
  ]);
  await db.collection("gamerooms").insertOne({
    roomId: "MERGE",
    status: "finished",
    seats: {
      white: { playerId: source.id, displayName: source.displayName },
      black: { playerId: friend.id, displayName: friend.displayName },
    },
  });
  await db.collection("storepurchases").insertOne({
    provider: "steam",
    playerId: source.id,
    externalId: "merge-order",
    itemId: "ocean",
    status: "granted",
  });
  const oldSession = await steam.mintSteamDesktopSession(source.id);
  const linked = await steam.linkSteamAccount("76561198000000051", targetId);
  assert.equal(linked.id, targetId);
  assert.equal((await steam.ensureSteamAccount("76561198000000051")).id, targetId);
  assert.deepEqual(new Set(linked.badges), new Set(["supporter", "web-badge"]));
  assert.deepEqual(linked.unlockedThemes, ["ocean"]);
  assert.equal(linked.hasSeenTutorial, true);
  assert.equal(linked.rating.overall.elo, 1700);
  assert.equal(linked.rating.overall.gamesPlayed, 20);
  assert.equal((await GameAccount.findById(friend.id)).friends[0].toString(), targetId);
  assert.equal(await GameAccount.findById(source.id), null);
  assert.equal(await verifySessionToken(oldSession.sessionToken), null);
  assert.equal(
    (await db.collection("storepurchases").findOne({ externalId: "merge-order" }))?.playerId,
    targetId,
  );
  assert.equal(
    (await db.collection("gamerooms").findOne({ roomId: "MERGE" }))?.seats.white.playerId,
    targetId,
  );
  assert.equal(await db.collection("achievements").countDocuments({ playerId: targetKey }), 2);
  assert.equal(
    (
      await db
        .collection("achievements")
        .findOne({ playerId: targetKey, achievementId: "first-win" })
    )?.unlockedAt.getTime(),
    1000,
  );
  assert.equal(
    (await steam.linkSteamAccount("76561198000000051", targetId)).rating.overall.gamesPlayed,
    20,
  );
});

test("linking refuses active play and accounts with another login without changing either account", async () => {
  const db = mongoose.connection.getClient().db();
  const source = await steam.ensureSteamAccount("76561198000000052");
  const signup = await auth.api.signUpEmail({
    body: { email: "busy-web@example.com", name: "busy-web", password: "test-password-123" },
  });
  const targetId = String(signup.user.id);
  await db.collection("gamerooms").insertOne({
    roomId: "BUSY-MERGE",
    status: "active",
    seats: { white: { playerId: source.id } },
  });
  await assert.rejects(steam.linkSteamAccount("76561198000000052", targetId), {
    code: "STEAM_LINK_BUSY",
  });
  assert.equal((await steam.findSteamAccount("76561198000000052")).id, source.id);
  await db.collection("gamerooms").deleteOne({ roomId: "BUSY-MERGE" });
  await db
    .collection("account")
    .insertOne({ userId: source._id, providerId: "google", accountId: "another-login" });
  await assert.rejects(steam.linkSteamAccount("76561198000000052", targetId), {
    code: "STEAM_LINK_CONFLICT",
  });
  assert.equal((await GameAccount.findById(targetId)).steamId, undefined);
});

test("native startup resumes a confirmed migration without adding game counts twice", async () => {
  const db = mongoose.connection.getClient().db();
  const source = await steam.ensureSteamAccount("76561198000000053");
  const signup = await auth.api.signUpEmail({
    body: { email: "retry-web@example.com", name: "retry-web", password: "test-password-123" },
  });
  const targetId = String(signup.user.id);
  await GameAccount.updateOne(
    { _id: source.id },
    { $set: { steamLinkTargetId: targetId, "rating.overall.gamesPlayed": 4 } },
  );
  await db
    .collection("steamAccountLinks")
    .insertOne({ _id: source._id, targetId, steamId: "76561198000000053" });
  await db
    .collection("gameaccounts")
    .updateOne(
      { _id: new mongoose.Types.ObjectId(targetId) },
      { $set: { mergedSteamSources: [source.id], "rating.overall.gamesPlayed": 7 } },
    );
  const linked = await steam.ensureSteamAccount("76561198000000053");
  assert.equal(linked.id, targetId);
  assert.equal(linked.rating.overall.gamesPlayed, 7);
  assert.equal(await GameAccount.findById(source.id), null);
});

test("native startup recovers after reserving the target SteamID and before provider reassignment", async () => {
  const db = mongoose.connection.getClient().db();
  const source = await steam.ensureSteamAccount("76561198000000054");
  const signup = await auth.api.signUpEmail({
    body: { email: "late-retry@example.com", name: "late-retry", password: "test-password-123" },
  });
  const targetId = String(signup.user.id);
  await GameAccount.updateOne(
    { _id: source.id },
    { $set: { steamLinkTargetId: targetId }, $unset: { steamId: 1 } },
  );
  await db
    .collection("steamAccountLinks")
    .insertOne({ _id: source._id, targetId, steamId: "76561198000000054" });
  await db.collection("gameaccounts").updateOne(
    { _id: new mongoose.Types.ObjectId(targetId) },
    {
      $set: {
        steamId: "76561198000000054",
        steamLinkSourceId: source.id,
        mergedSteamSources: [source.id],
        "rating.overall.gamesPlayed": 9,
      },
    },
  );
  const linked = await steam.ensureSteamAccount("76561198000000054");
  assert.equal(linked.id, targetId);
  assert.equal(linked.rating.overall.gamesPlayed, 9);
  assert.equal(await GameAccount.findById(source.id), null);
  assert.equal(await db.collection("steamAccountLinks").countDocuments({ _id: source._id }), 0);
});

test("a confirmed interrupted link cannot be redirected to a different web account", async () => {
  const db = mongoose.connection.getClient().db();
  const source = await steam.ensureSteamAccount("76561198000000055");
  const original = await auth.api.signUpEmail({
    body: { email: "bound-web@example.com", name: "bound-web", password: "test-password-123" },
  });
  const other = await auth.api.signUpEmail({
    body: { email: "other-web@example.com", name: "other-web", password: "test-password-123" },
  });
  const targetId = String(original.user.id),
    otherId = String(other.user.id);
  await GameAccount.updateOne({ _id: source.id }, { $set: { steamLinkTargetId: targetId } });
  await db
    .collection("steamAccountLinks")
    .insertOne({ _id: source._id, targetId, steamId: "76561198000000055" });
  await assert.rejects(steam.linkSteamAccount("76561198000000055", otherId), {
    code: "STEAM_LINK_CONFLICT",
  });
  assert.equal((await GameAccount.findById(otherId)).steamId, undefined);
  assert.equal((await steam.ensureSteamAccount("76561198000000055")).id, targetId);
});

test("finished tournament identities follow the merged account without changing authored text", async () => {
  const db = mongoose.connection.getClient().db();
  const source = await steam.ensureSteamAccount("76561198000000056");
  const signup = await auth.api.signUpEmail({
    body: {
      email: "tournament-web@example.com",
      name: "tournament-web",
      password: "test-password-123",
    },
  });
  const targetId = String(signup.user.id);
  await db.collection("tournaments").insertOne({
    tournamentId: "MERGED-HISTORY",
    revision: 0,
    status: "finished",
    creatorId: source.id,
    description: source.id,
    participants: [{ playerId: source.id }],
    groups: [{ participantIds: [source.id], standings: [{ playerId: source.id }] }],
    rounds: [
      {
        matches: [
          { winner: source.id, players: [{ playerId: source.id }], playerColors: [source.id] },
        ],
      },
    ],
  });
  await db.collection("tournamentmatches").insertOne({
    tournamentId: "MERGED-HISTORY",
    players: [{ playerId: source.id }],
    winner: source.id,
  });
  await steam.linkSteamAccount("76561198000000056", targetId);
  const history = await db.collection("tournaments").findOne({ tournamentId: "MERGED-HISTORY" });
  assert.equal(history?.creatorId, targetId);
  assert.equal(history?.participants[0].playerId, targetId);
  assert.equal(history?.groups[0].participantIds[0], targetId);
  assert.equal(history?.rounds[0].matches[0].winner, targetId);
  assert.equal(history?.description, source.id);
  assert.equal(
    (await db.collection("tournamentmatches").findOne({ tournamentId: "MERGED-HISTORY" }))?.winner,
    targetId,
  );
});

test("overlapping tournament history refuses the merge before moving either identity", async () => {
  const db = mongoose.connection.getClient().db();
  const source = await steam.ensureSteamAccount("76561198000000057");
  const signup = await auth.api.signUpEmail({
    body: { email: "overlap-web@example.com", name: "overlap-web", password: "test-password-123" },
  });
  const targetId = String(signup.user.id);
  await db.collection("tournaments").insertOne({
    tournamentId: "OVERLAP",
    status: "finished",
    participants: [{ playerId: source.id }, { playerId: targetId }],
  });
  await assert.rejects(steam.linkSteamAccount("76561198000000057", targetId), {
    code: "STEAM_LINK_CONFLICT",
  });
  assert.equal((await steam.findSteamAccount("76561198000000057")).id, source.id);
  assert.equal((await GameAccount.findById(targetId)).steamId, undefined);
});

test("retry completes provisioning after interruption between game and auth user creation", async () => {
  const reserved = await GameAccount.create({
    steamId: "76561198000000002",
    displayName: "interrupted",
  });
  const restored = await steam.findSteamAccount("76561198000000002");
  assert.equal(restored.id, reserved.id);
  assert.equal(restored.displayName, "interrupted");
  assert.ok((await steam.mintSteamDesktopSession(restored.id)).sessionToken);
});

test("link preserves the web player's identity, progress, friends and purchases", async () => {
  const web = await GameAccount.create({
    displayName: "web-player",
    badges: ["supporter"],
    unlockedThemes: ["ocean"],
    rating: { overall: { elo: 1700, gamesPlayed: 25 } },
  });
  const linked = await steam.linkSteamAccount("76561198000000003", web.id);
  assert.equal(linked.id, web.id);
  assert.deepEqual(linked.badges, ["supporter"]);
  assert.deepEqual(linked.unlockedThemes, ["ocean"]);
  assert.equal(linked.rating.overall.gamesPlayed, 25);
  assert.equal((await steam.linkSteamAccount("76561198000000003", web.id)).id, web.id);
  assert.equal((await steam.findSteamAccount("76561198000000003")).id, web.id);
});

test("a Steam identity cannot claim a second account or replace another linked identity", async () => {
  const other = await GameAccount.create({ displayName: "other-player" });
  await assert.rejects(steam.linkSteamAccount("76561198000000003", other.id), {
    code: "STEAM_LINK_CONFLICT",
  });
  const existing = await steam.findSteamAccount("76561198000000003");
  await assert.rejects(steam.linkSteamAccount("76561198000000004", existing.id), {
    code: "STEAM_LINK_CONFLICT",
  });
  assert.equal((await GameAccount.findById(other.id)).steamId, undefined);
});

test("duplicate usernames do not create stray auth users; invalid usernames are rejected", async () => {
  const db = mongoose.connection.getClient().db();
  const beforeCount = await db.collection("user").countDocuments();
  await assert.rejects(steam.createSteamAccount("76561198000000005", "web-player"), {
    code: "DUPLICATE_USERNAME",
  });
  await assert.rejects(steam.createSteamAccount("76561198000000005", "bad name"), {
    code: "INVALID_USERNAME",
  });
  assert.equal(await db.collection("user").countDocuments(), beforeCount);
});

test("untrusted AppIDs and malformed tickets are rejected before contacting Steam", async () => {
  for (const [ticket, appId] of [
    ["aabb", 480],
    ["odd", 5035580],
    ["aabb", "5035580"],
    ["aabb", 0],
  ]) {
    await assert.rejects(steam.verifySteamAuthTicket(ticket, appId), {
      code: "INVALID_STEAM_TICKET",
    });
  }
  assert.deepEqual(steam.steamAuthAppIds({}), [5035580, 5491870]);
});

test("auth tickets use a separate identity and always select the verified player", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.STEAM_PUBLISHER_WEB_API_KEY;
  process.env.STEAM_PUBLISHER_WEB_API_KEY = "fake-publisher-key";
  let banned = false;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("identity"), "tiao-auth");
    assert.equal(url.searchParams.get("appid"), "5491870");
    return new Response(
      JSON.stringify({
        response: {
          params: {
            result: "OK",
            steamid: "76561198000000006",
            ownersteamid: "76561198000000099",
            publisherbanned: banned,
          },
        },
      }),
    );
  }) as typeof fetch;
  try {
    assert.equal(await steam.verifySteamAuthTicket("aabb", 5491870), "76561198000000006");
    banned = true;
    await assert.rejects(steam.verifySteamAuthTicket("aabb", 5491870), {
      code: "INVALID_STEAM_TICKET",
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.STEAM_PUBLISHER_WEB_API_KEY;
    else process.env.STEAM_PUBLISHER_WEB_API_KEY = originalKey;
  }
});

test("HTTP routes require both account and Steam proofs and return the original linked identity", async () => {
  const express = (await import("express")).default;
  const { createServer } = await import("node:http");
  const { createSteamAuthRouter } = await import("../../routes/steam-auth.routes");
  const { requireAccount } = await import("../../auth/sessionHelper");
  const desktopRoutes = (await import("../../routes/desktop-auth.routes")).default;
  const app = express();
  app.use(express.json());
  let ticketValid = true;
  let verifiedSteamId = "76561198000000010";
  app.use("/api/player", (await import("../../routes/game-auth.routes")).default);
  app.use(
    "/steam",
    createSteamAuthRouter({
      verify: async () => {
        if (!ticketValid)
          throw new steam.SteamAccountError(401, "INVALID_STEAM_TICKET", "Invalid ticket");
        return verifiedSteamId;
      },
      find: steam.findSteamAccount,
      create: steam.createSteamAccount,
      link: steam.linkSteamAccount,
      mint: steam.mintSteamDesktopSession,
      requireAccount,
      ensure: steam.ensureSteamAccount,
    }),
  );
  app.use("/desktop", desktopRoutes);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
  const post = (path: string, body: unknown, token?: string) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  try {
    assert.equal((await post("/steam/session", { action: "link", userId: "forged" })).status, 401);
    assert.equal((await post("/desktop/session", {})).status, 401);
    const check = await post("/steam/session", { action: "check" });
    assert.equal(((await check.json()) as { status: string }).status, "signed_in");
    const signed = await steam.createSteamAccount("76561198000000011", "web-route-player");
    const original = await steam.mintSteamDesktopSession(signed.id);
    ticketValid = false;
    assert.equal(
      (await post("/steam/session", { action: "link" }, original.sessionToken)).status,
      401,
    );
    ticketValid = true;
    // This account already belongs to another Steam player: no reassignment.
    assert.equal(
      (await post("/steam/session", { action: "link" }, original.sessionToken)).status,
      409,
    );
    const createdResponse = await post("/steam/session", {
      action: "create",
      username: "http-steam-player",
      steamId: "forged",
    });
    assert.equal(createdResponse.status, 200);
    const created = (await createdResponse.json()) as { userId: string; sessionToken: string };
    const again = (await (await post("/steam/session", { action: "check" })).json()) as {
      userId: string;
    };
    assert.equal(again.userId, created.userId);
    assert.equal((await verifySessionToken(created.sessionToken))?.userId, created.userId);
    assert.equal((await steam.findSteamAccount("76561198000000010")).id, created.userId);
    assert.equal(createdResponse.headers.get("cache-control"), "no-store");

    // A web-first player proves their normal login, then attaches Steam to
    // that exact account. The mapping never creates a second game profile.
    const signup = await auth.api.signUpEmail({
      body: {
        email: "web-first@example.com",
        password: "test-password-123",
        name: "web-first-player",
      },
      asResponse: true,
    });
    assert.equal(signup.status, 200);
    const signedBearer = signup.headers.get("set-auth-token");
    assert.ok(signedBearer);
    const upgraded = await post("/desktop/session", {}, signedBearer);
    assert.equal(upgraded.status, 200);
    const desktop = (await upgraded.json()) as { sessionToken: string; userId: string };
    verifiedSteamId = "76561198000000012";
    const linkedResponse = await post("/steam/session", { action: "link" }, desktop.sessionToken);
    assert.equal(linkedResponse.status, 200);
    const linked = (await linkedResponse.json()) as { userId: string; sessionToken: string };
    assert.equal(linked.userId, desktop.userId);
    const profile = await fetch(`${base}/api/player/profile`, {
      headers: { authorization: `Bearer ${linked.sessionToken}` },
    });
    assert.equal(profile.status, 200);
    const profileBody = (await profile.json()) as {
      profile: { providers: string[]; email: string };
    };
    assert.deepEqual(new Set(profileBody.profile.providers), new Set(["credential", "steam"]));
    assert.equal(profileBody.profile.email, "web-first@example.com");

    // A Steam-first player can add a web password and sign in to the same ID.
    const added = await post(
      "/api/player/set-password",
      { password: "test-password-123", email: "steam-first@example.com" },
      created.sessionToken,
    );
    assert.equal(added.status, 200);
    const login = await post("/api/player/login", {
      identifier: "steam-first@example.com",
      password: "test-password-123",
    });
    assert.equal(login.status, 200);
    const webPlayer = (await login.json()) as { player: { playerId: string } };
    assert.equal(webPlayer.player.playerId, created.userId);
    assert.ok(login.headers.get("set-auth-token"));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
