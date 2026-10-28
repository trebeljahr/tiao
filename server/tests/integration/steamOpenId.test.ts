import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { after, before, test } from "node:test";
import mongoose from "mongoose";

const BASE = "https://api.tiao.test";
const FRONTEND = "https://tiao.test";
const DB = `tiao_test_steam_openid_${process.pid}`;
process.env.NODE_ENV = "test";
const mongoUrl = new URL(process.env.MONGODB_TEST_URI ?? "mongodb://127.0.0.1:27017");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(mongoUrl.hostname), "Use a local disposable MongoDB fixture");
mongoUrl.pathname = `/${DB}`;
process.env.MONGODB_URI = mongoUrl.toString();
process.env.BETTER_AUTH_URL = BASE;
process.env.FRONTEND_URL = FRONTEND;
process.env.TOKEN_SECRET = "fake-steam-openid-secret";
process.env.STEAM_WEB_API_KEY = "fake-profile-key";
let auth: typeof import("../../auth/auth").auth;
let GameAccount: typeof import("../../models/GameAccount").default;
let steam: typeof import("../../auth/steamAccount");
let openid: typeof import("../../auth/steamOpenId");
const fetchOriginal = globalThis.fetch;
let checks = 0;

before(async () => {
  await mongoose.connect(process.env.MONGODB_URI!, { serverSelectionTimeoutMS: 3000 });
  process.env.APPLE_CLIENT_ID = "test.tiao.signin";
  process.env.APPLE_TEAM_ID = "TESTTEAM01";
  process.env.APPLE_KEY_ID = "TESTKEY001";
  process.env.APPLE_PRIVATE_KEY = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    .privateKey.export({ format: "pem", type: "pkcs8" })
    .toString();
  auth = (await import("../../auth/auth")).auth;
  GameAccount = (await import("../../models/GameAccount")).default;
  steam = await import("../../auth/steamAccount");
  openid = await import("../../auth/steamOpenId");
  await GameAccount.init();
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    if (url.href === openid.STEAM_OPENID_ENDPOINT) {
      checks++;
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get("openid.mode"), "check_authentication");
      return new Response(
        `is_valid:${body.get("openid.sig") === "fake-valid-signature" ? "true" : "false"}\n`,
      );
    }
    if (url.hostname === "api.steampowered.com") {
      return Response.json({
        response: {
          players: [
            {
              steamid: url.searchParams.get("steamids"),
              personaname: "Mäia Jump!",
              avatarfull: "https://avatars.steamstatic.com/fake-avatar_full.jpg",
            },
          ],
        },
      });
    }
    throw new Error("Unexpected external request");
  }) as typeof fetch;
});
after(async () => {
  globalThis.fetch = fetchOriginal;
  if (mongoose.connection.readyState) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (auth) await (await import("../../auth/auth")).closeAuthDatabaseForTests();
});

class Browser {
  cookies = new Map<string, string>();
  async request(path: string, body?: Record<string, unknown>, origin = FRONTEND) {
    const response = await auth.handler(
      new Request(path.startsWith("https:") ? path : `${BASE}/api/auth${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          origin,
          cookie: [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; "),
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
    this.absorb(response);
    return response;
  }
  absorb(response: Response) {
    for (const header of response.headers.getSetCookie()) {
      const part = header.split(";")[0];
      const equal = part.indexOf("=");
      const key = part.slice(0, equal),
        value = part.slice(equal + 1);
      if (!value || /max-age=0/i.test(header)) this.cookies.delete(key);
      else this.cookies.set(key, value);
    }
  }
  async begin(intent = "sign-in", returnPath = "/en/play") {
    const response = await this.request("/steam/start", { intent, returnPath });
    assert.equal(response.status, 200, await response.clone().text());
    const { url } = (await response.json()) as { url: string };
    return new URL(url).searchParams.get("openid.return_to")!;
  }
  async callback(returnTo: string, steamId: string, change?: (params: URLSearchParams) => void) {
    const target = new URL(returnTo);
    const query = target.searchParams;
    for (const [key, value] of Object.entries({
      ns: openid.OPENID_NS,
      mode: "id_res",
      op_endpoint: openid.STEAM_OPENID_ENDPOINT,
      claimed_id: `https://steamcommunity.com/openid/id/${steamId}`,
      identity: `https://steamcommunity.com/openid/id/${steamId}`,
      return_to: returnTo,
      response_nonce: `${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}${crypto.randomUUID()}`,
      assoc_handle: "fake-association",
      signed: "op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
      sig: "fake-valid-signature",
    }))
      query.set(`openid.${key}`, value);
    change?.(query);
    return this.request(target.href);
  }
  async signUp(email: string, name: string) {
    const response = await auth.api.signUpEmail({
      body: { email, name, password: "test-password-123" },
      asResponse: true,
    });
    assert.equal(response.status, 200);
    this.absorb(response);
    const user = (await response.json()).user;
    return String(user.id);
  }
  async session() {
    return (await (await this.request("/get-session")).json()) as {
      user: { id: string; name: string };
    } | null;
  }
}

let nativeUserId: string;
test("new browser Steam sign-in defers account creation and exposes profile defaults", async () => {
  const browser = new Browser();
  const count = await GameAccount.countDocuments();
  const callback = await browser.callback(await browser.begin(), "76561198000000101");
  assert.equal(callback.status, 302, await callback.clone().text());
  assert.equal(callback.headers.get("location"), `${FRONTEND}/en/play`);
  assert.equal(await GameAccount.countDocuments(), count);
  const pending = (await (await browser.request("/steam/pending")).json()) as {
    status: string;
    profile: { suggestedUsername: string; avatarUrl: string };
  };
  assert.equal(pending.status, "needs_setup");
  assert.equal(pending.profile.suggestedUsername, "maia-jump");
  assert.match(pending.profile.avatarUrl, /avatars\.steamstatic\.com/);
  assert.ok([...browser.cookies.keys()].some((name) => name.endsWith("steam_pending")));
  const finish = await browser.request("/steam/finish", {
    action: "create",
    username: pending.profile.suggestedUsername,
  });
  assert.equal(finish.status, 200, await finish.clone().text());
  const session = await browser.session();
  assert.ok(session);
  nativeUserId = session.user.id;
  assert.match(nativeUserId, /^[a-f\d]{24}$/);
  assert.notEqual(nativeUserId, "76561198000000101");
  const profile = await GameAccount.findById(nativeUserId);
  assert.equal(profile.profilePicture, pending.profile.avatarUrl);
  const rows = await mongoose.connection
    .getClient()
    .db()
    .collection("account")
    .find({ providerId: "steam", accountId: "76561198000000101" })
    .toArray();
  assert.equal(rows.length, 1);
  assert.equal(String(rows[0].userId), nativeUserId);
  assert.equal((await steam.findSteamAccount("76561198000000101")).id, nativeUserId);
});

test("returning web and native Steam logins use one ID and preserve custom profile changes", async () => {
  await GameAccount.updateOne(
    { _id: nativeUserId },
    {
      $set: {
        displayName: "chosen-name",
        profilePicture: "https://assets.playtiao.test/custom-avatar.jpg",
      },
    },
  );
  const browser = new Browser();
  const response = await browser.callback(await browser.begin(), "76561198000000101");
  assert.equal(response.status, 302);
  assert.equal((await browser.session())?.user.id, nativeUserId);
  assert.equal((await steam.findSteamAccount("76561198000000101")).displayName, "chosen-name");
  assert.equal(
    (await GameAccount.findById(nativeUserId)).profilePicture,
    "https://assets.playtiao.test/custom-avatar.jpg",
  );
  assert.deepEqual(await (await browser.request("/steam/pending")).json(), { status: "none" });
});

test("Steam-first signup can link an existing web account before creating a duplicate", async () => {
  const web = new Browser();
  const id = await web.signUp("existing-web@example.com", "existing-web");
  await GameAccount.updateOne(
    { _id: id },
    { $set: { badges: ["supporter"], "rating.overall.gamesPlayed": 31 } },
  );
  const count = await GameAccount.countDocuments();
  const browser = new Browser();
  await browser.callback(await browser.begin(), "76561198000000102");
  assert.equal(await GameAccount.countDocuments(), count);
  assert.equal(
    (await browser.request("/steam/finish", { action: "link", userId: id })).status,
    401,
  );
  const login = await auth.api.signInEmail({
    body: { email: "existing-web@example.com", password: "test-password-123" },
    asResponse: true,
  });
  browser.absorb(login);
  const finish = await browser.request("/steam/finish", { action: "link" });
  assert.equal(finish.status, 200, await finish.clone().text());
  assert.equal((await browser.session())?.user.id, id);
  assert.equal((await steam.findSteamAccount("76561198000000102")).id, id);
  assert.equal(await GameAccount.countDocuments(), count);
  const profile = await GameAccount.findById(id);
  assert.equal(profile.rating.overall.gamesPlayed, 31);
  assert.deepEqual(profile.badges, ["supporter"]);
  assert.equal(profile.profilePicture, undefined);
});

test("web settings can link Steam and Better Auth lists and unlinks the provider correctly", async () => {
  const browser = new Browser();
  const id = await browser.signUp("web-settings@example.com", "web-settings");
  const response = await browser.callback(
    await browser.begin("link", "/en/settings"),
    "76561198000000103",
  );
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), `${FRONTEND}/en/settings`);
  assert.equal((await steam.findSteamAccount("76561198000000103")).id, id);
  const providers = (await (await browser.request("/list-accounts")).json()) as Array<{
    id: string;
    providerId: string;
  }>;
  assert.deepEqual(
    new Set(providers.map((provider) => provider.providerId)),
    new Set(["credential", "steam"]),
  );
  const row = providers.find((provider) => provider.providerId === "steam")!;
  assert.equal((await browser.request("/unlink-account", { accountId: row.id })).status, 200);
  assert.equal(await steam.findSteamAccount("76561198000000103"), null);
  assert.equal((await GameAccount.findById(id)).steamId, undefined);
});

test("Steam linking cannot move a Steam identity already owned by another Tiao user", async () => {
  const browser = new Browser();
  const id = await browser.signUp("conflict@example.com", "conflict-player");
  const response = await browser.callback(await browser.begin("link"), "76561198000000101");
  assert.match(response.headers.get("location")!, /error=steam_link_conflict/);
  assert.equal((await steam.findSteamAccount("76561198000000101")).id, nativeUserId);
  assert.equal((await GameAccount.findById(id)).steamId, undefined);
});

test("unbound callbacks, hostile origins and anonymous link attempts are rejected", async () => {
  const browser = new Browser();
  assert.equal((await browser.request("/steam/start", { intent: "link" })).status, 401);
  assert.equal((await browser.request("/steam/start", {}, "https://attacker.invalid")).status, 403);
  const returnTo = await browser.begin();
  const stranger = new Browser();
  assert.equal((await stranger.callback(returnTo, "76561198000000104")).status, 400);
  assert.equal(await steam.findSteamAccount("76561198000000104"), null);
});

test("forged OpenID assertions and repeated nonces cannot create a session", async () => {
  for (const change of [
    (q: URLSearchParams) => q.set("openid.sig", "invalid"),
    (q: URLSearchParams) => q.set("openid.return_to", "https://attacker.invalid"),
    (q: URLSearchParams) =>
      q.set("openid.claimed_id", "https://attacker.invalid/openid/id/76561198000000105"),
    (q: URLSearchParams) => q.set("openid.signed", "identity"),
    (q: URLSearchParams) => q.append("openid.identity", q.get("openid.identity")!),
    (q: URLSearchParams) => q.set("openid.response_nonce", "2020-01-01T00:00:00Zexpired"),
  ]) {
    const browser = new Browser();
    const response = await browser.callback(await browser.begin(), "76561198000000105", change);
    assert.match(response.headers.get("location")!, /error=steam_sign_in_failed/);
    assert.equal(await browser.session(), null);
  }
  const nonce = `${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}same-nonce`;
  const one = new Browser();
  await one.callback(await one.begin(), "76561198000000105", (q) =>
    q.set("openid.response_nonce", nonce),
  );
  const two = new Browser();
  const response = await two.callback(await two.begin(), "76561198000000105", (q) =>
    q.set("openid.response_nonce", nonce),
  );
  assert.match(response.headers.get("location")!, /error=steam_sign_in_failed/);
  assert.ok(checks > 0);
});

test("return paths stay on Tiao and pending proof can be cancelled without creating an account", async () => {
  assert.equal(openid.steamReturnPath("//attacker.invalid"), "/en/play");
  assert.equal(openid.steamReturnPath("/\\attacker.invalid"), "/en/play");
  const browser = new Browser();
  await browser.callback(await browser.begin(), "76561198000000106");
  assert.equal((await browser.request("/steam/finish", { action: "cancel" })).status, 200);
  assert.deepEqual(await (await browser.request("/steam/pending")).json(), { status: "none" });
  assert.equal(await steam.findSteamAccount("76561198000000106"), null);
});

test("native ticket routes leave Better Auth's browser request bodies intact", async () => {
  const express = (await import("express")).default;
  const { createServer } = await import("node:http");
  const { toNodeHandler } = await import("better-auth/node");
  const app = express();
  app.use("/api/auth/steam", (await import("../../routes/steam-auth.routes")).default);
  app.all("/api/auth/*splat", toNodeHandler(auth));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as import("node:net").AddressInfo).port;
    const result = await fetchOriginal(`http://127.0.0.1:${port}/api/auth/steam/start`, {
      method: "POST",
      headers: { origin: FRONTEND, "content-type": "application/json" },
      body: JSON.stringify({ intent: "link" }),
    });
    assert.equal(result.status, 401);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("guest-to-Steam login reuses Tiao's guest game migration and cleans up the guest", async () => {
  const browser = new Browser();
  assert.equal((await browser.request("/sign-in/anonymous", {})).status, 200);
  const guest = await browser.session();
  assert.ok(guest);
  const { gameService } = await import("../../game/gameService");
  const original = gameService.migrateGuestToAccount;
  const migrations: Array<{ guestId: string; playerId: string }> = [];
  gameService.migrateGuestToAccount = async (guestId, player) => {
    migrations.push({ guestId, playerId: player.playerId });
    return { migrated: 0, deleted: 0, deletedRoomIds: [] };
  };
  try {
    const response = await browser.callback(await browser.begin(), "76561198000000101");
    assert.equal(response.status, 302);
    assert.equal((await browser.session())?.user.id, nativeUserId);
    assert.deepEqual(migrations, [{ guestId: guest.user.id, playerId: nativeUserId }]);
    assert.equal(
      await mongoose.connection
        .getClient()
        .db()
        .collection("user")
        .countDocuments({ _id: new mongoose.Types.ObjectId(guest.user.id) }),
      0,
    );
  } finally {
    gameService.migrateGuestToAccount = original;
  }
});

/** Exercise the standalone desktop browser bridge with real auth/session storage. */
async function desktopServer() {
  const express = (await import("express")).default;
  const { createServer } = await import("node:http");
  const app = express();
  app.use(express.json());
  app.use("/api/auth/desktop", (await import("../../routes/desktop-auth.routes")).default);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as import("node:net").AddressInfo).port;
  return {
    async request(path: string, browser: Browser, body?: Record<string, unknown>, token?: string) {
      const response = await fetchOriginal(`http://127.0.0.1:${port}${path}`, {
        redirect: "manual",
        method: body ? "POST" : "GET",
        headers: {
          cookie: [...browser.cookies].map(([key, value]) => `${key}=${value}`).join("; "),
          ...(body ? { "content-type": "application/json" } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      browser.absorb(response);
      return response;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function redeemDesktop(
  server: Awaited<ReturnType<typeof desktopServer>>,
  browser: Browser,
  callback: string,
) {
  const url = new URL(callback);
  const complete = await server.request(url.pathname + url.search, browser);
  assert.equal(complete.status, 302, await complete.clone().text());
  const deepLink = new URL(complete.headers.get("location")!);
  assert.equal(deepLink.host, "auth");
  assert.equal(deepLink.pathname, "/complete", deepLink.href);
  const exchange = await server.request("/api/auth/desktop/exchange", browser, {
    state: deepLink.searchParams.get("state"),
    code: deepLink.searchParams.get("code"),
  });
  assert.equal(exchange.status, 200, await exchange.clone().text());
  return (await exchange.json()) as { userId: string; sessionToken: string };
}

test("standalone desktop Steam sign-in returns a revocable desktop session", async () => {
  const server = await desktopServer();
  try {
    const browser = new Browser();
    const start = await server.request(
      "/api/auth/desktop/start?provider=steam&state=desktop-steam-signin",
      browser,
    );
    assert.equal(start.status, 302, await start.clone().text());
    const returnTo = new URL(start.headers.get("location")!).searchParams.get("openid.return_to")!;
    const callback = await browser.callback(returnTo, "76561198000000101");
    const next = callback.headers.get("location")!;
    assert.match(next, /\/api\/auth\/desktop\/flow\/callback\?ticket=/);
    assert.equal((await redeemDesktop(server, browser, next)).userId, nativeUserId);
    assert.equal(
      (await server.request(new URL(next).pathname + new URL(next).search, browser)).status,
      400,
    );
  } finally {
    await server.close();
  }
});

test("new desktop Steam accounts finish username setup in the browser before returning to the app", async () => {
  const server = await desktopServer();
  try {
    const browser = new Browser();
    const start = await server.request(
      "/api/auth/desktop/start?provider=steam&state=desktop-steam-create",
      browser,
    );
    assert.equal(start.status, 302, await start.clone().text());
    const returnTo = new URL(start.headers.get("location")!).searchParams.get("openid.return_to")!;
    const callback = await browser.callback(returnTo, "76561198000000120");
    assert.equal(callback.headers.get("location"), `${FRONTEND}/en/play`);
    assert.equal(await steam.findSteamAccount("76561198000000120"), null);
    const finish = await browser.request("/steam/finish", {
      action: "create",
      username: "desktop-new-player",
    });
    assert.equal(finish.status, 200, await finish.clone().text());
    const result = (await finish.json()) as { redirectPath: string };
    assert.match(result.redirectPath, /^\/api\/auth\/desktop\/flow\/callback\?ticket=/);
    const account = await steam.findSteamAccount("76561198000000120");
    assert.equal(
      (await redeemDesktop(server, browser, new URL(result.redirectPath, BASE).href)).userId,
      account.id,
    );
  } finally {
    await server.close();
  }
});

test("desktop Steam linking targets the app account even when the browser has a different login", async () => {
  const server = await desktopServer();
  try {
    const appBrowser = new Browser();
    const userId = await appBrowser.signUp("desktop-link@example.com", "desktop-link");
    const desktop = await steam.mintSteamDesktopSession(userId);
    const browser = new Browser();
    const otherId = await browser.signUp("desktop-other@example.com", "desktop-other");
    const start = await server.request(
      "/api/auth/desktop/link/start",
      browser,
      { provider: "steam", state: "desktop-link-state-012345" },
      desktop.sessionToken,
    );
    assert.equal(start.status, 200, await start.clone().text());
    const { path } = (await start.json()) as { path: string };
    assert.ok(!path.includes(desktop.sessionToken));
    const begin = await server.request(path, browser);
    assert.equal(begin.status, 302);
    assert.equal(begin.headers.get("referrer-policy"), "no-referrer");
    const returnTo = new URL(begin.headers.get("location")!).searchParams.get("openid.return_to")!;
    const callback = await browser.callback(returnTo, "76561198000000121");
    assert.equal((await steam.findSteamAccount("76561198000000121")).id, userId);
    assert.equal((await browser.session())?.user.id, otherId);
    const fresh = await redeemDesktop(server, browser, callback.headers.get("location")!);
    assert.equal(fresh.userId, userId);
    const { verifySessionToken } = await import("../../auth/desktopSessionManager");
    assert.equal(
      await verifySessionToken(desktop.sessionToken),
      null,
      "linking revokes the old credential snapshot",
    );
    assert.ok(await verifySessionToken(fresh.sessionToken));
    const replay = await server.request(path, browser);
    assert.match(replay.headers.get("location")!, /link_expired/);
  } finally {
    await server.close();
  }
});

test("desktop link start rejects unauthenticated requests and unknown providers", async () => {
  const server = await desktopServer();
  try {
    const browser = new Browser();
    assert.equal(
      (
        await server.request("/api/auth/desktop/link/start", browser, {
          provider: "steam",
          state: "desktop-link-state-012345",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await server.request("/api/auth/desktop/link/start", browser, {
          provider: "myspace",
          state: "desktop-link-state-012345",
        })
      ).status,
      400,
    );
    assert.equal(
      (await server.request("/api/auth/desktop/flow/callback?ticket=forged", browser)).status,
      400,
    );
  } finally {
    await server.close();
  }
});

test("Apple sign-in and linking start through the actual desktop browser bridge", async () => {
  const server = await desktopServer();
  try {
    const browser = new Browser();
    const login = await server.request(
      "/api/auth/desktop/start?provider=apple&state=desktop-apple-login",
      browser,
    );
    assert.equal(login.status, 302, await login.clone().text());
    assert.equal(new URL(login.headers.get("location")!).origin, "https://appleid.apple.com");
    assert.ok(login.headers.getSetCookie().length > 0);
    const userId = await browser.signUp("apple-desktop@example.com", "apple-desktop");
    const desktop = await steam.mintSteamDesktopSession(userId);
    const start = await server.request(
      "/api/auth/desktop/link/start",
      browser,
      { provider: "apple", state: "desktop-apple-link-012345" },
      desktop.sessionToken,
    );
    assert.equal(start.status, 200, await start.clone().text());
    const { path } = (await start.json()) as { path: string };
    const begin = await server.request(path, new Browser());
    assert.equal(begin.status, 302);
    assert.equal(new URL(begin.headers.get("location")!).origin, "https://appleid.apple.com");
    assert.ok(begin.headers.getSetCookie().length > 0);
    assert.ok(!begin.headers.get("location")!.includes(desktop.sessionToken));
  } finally {
    await server.close();
  }
});

test("desktop Steam cancellation returns to the app without minting a login", async () => {
  const server = await desktopServer();
  try {
    const browser = new Browser();
    const start = await server.request(
      "/api/auth/desktop/start?provider=steam&state=desktop-cancel-012345",
      browser,
    );
    const returnTo = new URL(start.headers.get("location")!).searchParams.get("openid.return_to")!;
    const target = new URL(returnTo);
    target.searchParams.set("openid.mode", "cancel");
    const callback = await browser.request(target.href);
    const next = new URL(callback.headers.get("location")!);
    const complete = await server.request(next.pathname + next.search, browser);
    assert.equal(
      complete.headers.get("location"),
      "tiao://auth/error?state=desktop-cancel-012345&reason=steam_cancelled",
    );
    assert.equal(await browser.session(), null);
  } finally {
    await server.close();
  }
});
