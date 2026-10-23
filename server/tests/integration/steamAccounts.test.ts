import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import mongoose from "mongoose";

const DB_NAME = `tiao_test_steam_accounts_${process.pid}`;
process.env.TOKEN_SECRET = "steam-test-secret";
process.env.MONGODB_URI = `mongodb://127.0.0.1:27017/${DB_NAME}`;
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
  if (mongoose.connection.readyState) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  // Better Auth owns a separate MongoClient. Close its adapter's pool too.
  if (auth) await (await import("../../auth/auth")).closeAuthDatabaseForTests();
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
    assert.equal(((await check.json()) as { status: string }).status, "needs_setup");
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
