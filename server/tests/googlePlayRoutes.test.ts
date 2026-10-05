process.env.TOKEN_SECRET = "test-secret";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/tiao-test";
process.env.S3_BUCKET_NAME = "tiao-test-assets";
process.env.S3_PUBLIC_URL = "https://assets.test.local";
process.env.NODE_ENV = "test";

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { Router } from "express";
import mongoose from "mongoose";
import GameAccount from "../models/GameAccount";
import { setGooglePlayApiForTesting } from "../payments/googlePlayApi";
import { playAccountIdFor, playSubscriptionId } from "../payments/googlePlayFulfillment";
import { encodeNotification, FakeGooglePlay, MemoryPlayStore } from "./googlePlayTestKit";
import {
  createTestAccount,
  createTestGuest,
  installTestSessionMock,
  resetTestSessions,
} from "./testAuthHelper";

type Result = { status: number; body: any };
type Layer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: (...args: any[]) => unknown }>;
  };
};

async function invoke(
  router: Router,
  method: "GET" | "POST",
  path: string,
  options: {
    cookie?: string;
    body?: unknown;
    query?: Record<string, string>;
    headers?: Record<string, string>;
  } = {},
): Promise<Result> {
  const layer = (router as unknown as { stack: Layer[] }).stack.find(
    (l) => l.route?.path === path && l.route.methods[method.toLowerCase()],
  );
  if (!layer?.route) throw new Error(`Route ${method} ${path} not found`);
  const result: Result = { status: 200, body: undefined };
  const res: any = {
    status(code: number) {
      result.status = code;
      return res;
    },
    json(payload: unknown) {
      result.body = payload;
      return res;
    },
    end() {
      return res;
    },
    setHeader() {
      return res;
    },
  };
  const req = {
    method,
    path,
    url: path,
    params: {},
    query: options.query ?? {},
    body: options.body ?? {},
    headers: { cookie: options.cookie ?? "", host: "localhost:5005", ...options.headers },
    get: (name: string) => (name === "host" ? "localhost:5005" : undefined),
    protocol: "http",
  };
  for (const handler of layer.route.stack) {
    await handler.handle(req, res, () => {});
  }
  return result;
}

describe("Google Play routes", () => {
  let router: Router;
  let shopRouter: Router;
  let google: FakeGooglePlay;
  let store: MemoryPlayStore;
  const accountUpdates: unknown[] = [];
  const mockAccounts = new Map<string, Record<string, unknown>>();

  beforeEach(async () => {
    resetTestSessions();
    await installTestSessionMock();
    accountUpdates.length = 0;
    mockAccounts.clear();
    delete process.env.GOOGLE_PLAY_RTDN_AUDIENCE;
    delete process.env.GOOGLE_PLAY_RTDN_TOKEN;
    process.env.GOOGLE_PLAY_BILLING_ENABLED = "true";

    const accountModel = GameAccount as unknown as Record<string, unknown>;
    accountModel.updateOne = async (filter: unknown, update: unknown) => {
      accountUpdates.push({ filter, update });
      return { matchedCount: 1 };
    };
    accountModel.findById = async (id: string) => mockAccounts.get(id) ?? null;
    // See shopRoutes.test.ts: models compiled after readyState flips need a db stub.
    Object.defineProperty(mongoose.connection, "readyState", { get: () => 1, configurable: true });
    Object.defineProperty(mongoose.connection, "db", {
      get: () => ({
        collection: (name: string) => ({
          name,
          collectionName: name,
          createIndex: async () => undefined,
          createIndexes: async () => undefined,
        }),
      }),
      configurable: true,
    });

    google = new FakeGooglePlay();
    store = new MemoryPlayStore(() => google.now);
    setGooglePlayApiForTesting(google.api());
    const mod = await import("../routes/googlePlay.routes");
    mod.setGooglePlayRouteDepsForTesting({ store });
    router = mod.default;
    shopRouter = (await import("../routes/shop.routes")).default;
  });

  afterEach(() => {
    setGooglePlayApiForTesting(undefined);
    delete process.env.STRIPE_SECRET_KEY;
    resetTestSessions();
  });

  test("GET /config reports Play as off when no service account is configured", async () => {
    setGooglePlayApiForTesting(null);
    const result = await invoke(router, "GET", "/config");
    assert.equal(result.body.enabled, false);
    assert.equal(result.body.obfuscatedAccountId, null);
    assert.ok(
      result.body.products.some((p: { productId: string }) => p.productId === "sub_patron"),
    );
  });

  test("GET /config keeps the storefront off until the rollout flag is set", async () => {
    process.env.GOOGLE_PLAY_BILLING_ENABLED = "false";
    const account = createTestAccount("player", "player@test.com");
    const result = await invoke(router, "GET", "/config", { cookie: account.cookie });
    assert.equal(result.body.enabled, false);
    // Purchases still verify while the storefront is hidden (license testing).
    assert.equal(result.body.obfuscatedAccountId, playAccountIdFor(account.player.playerId));
  });

  test("GET /config gives an account its obfuscated id and stores it for RTDN lookups", async () => {
    const account = createTestAccount("player", "player@test.com");
    const result = await invoke(router, "GET", "/config", { cookie: account.cookie });
    const expected = playAccountIdFor(account.player.playerId);
    assert.equal(result.body.enabled, true);
    assert.equal(result.body.packageName, "com.ricoslabs.tiao");
    assert.equal(result.body.obfuscatedAccountId, expected);
    assert.equal(expected.length, 64, "Play caps obfuscatedAccountId at 64 chars");
    assert.deepEqual(accountUpdates, [
      {
        filter: { _id: account.player.playerId, googlePlayAccountId: { $ne: expected } },
        update: { $set: { googlePlayAccountId: expected } },
      },
    ]);
    const patron = result.body.products.find((p: { itemId: string }) => p.itemId === "patron");
    assert.deepEqual(patron, {
      productId: "sub_patron",
      basePlanId: "monthly",
      productType: "subs",
      itemType: "badge",
      itemId: "patron",
    });
  });

  test("POST /verify requires an account, configuration and a well-formed purchase", async () => {
    const guest = createTestGuest("Guest");
    assert.equal(
      (await invoke(router, "POST", "/verify", { cookie: guest.cookie, body: {} })).status,
      401,
    );

    const account = createTestAccount("player", "player@test.com");
    for (const body of [
      {},
      { productId: "Bad Id", purchaseToken: "t" },
      { productId: "badge_coral" },
    ]) {
      const result = await invoke(router, "POST", "/verify", { cookie: account.cookie, body });
      assert.equal(result.status, 400);
      assert.equal(result.body.code, "INVALID_PURCHASE");
    }

    setGooglePlayApiForTesting(null);
    const off = await invoke(router, "POST", "/verify", {
      cookie: account.cookie,
      body: { productId: "badge_coral", purchaseToken: "t" },
    });
    assert.equal(off.status, 503);
    assert.equal(off.body.code, "GOOGLE_PLAY_NOT_CONFIGURED");
  });

  test("POST /verify grants a verified purchase and maps Google failures", async () => {
    const account = createTestAccount("player", "player@test.com");
    const playerId = account.player.playerId;
    google.addProduct("tok-1", "badge_coral", {
      obfuscatedExternalAccountId: playAccountIdFor(playerId),
    });

    const ok = await invoke(router, "POST", "/verify", {
      cookie: account.cookie,
      body: { productId: "badge_coral", purchaseToken: "tok-1" },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.status, "granted");
    assert.ok(store.account(playerId).badges.has("badge-1"));

    const unknown = await invoke(router, "POST", "/verify", {
      cookie: account.cookie,
      body: { productId: "badge_coral", purchaseToken: "nope" },
    });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.code, "INVALID_PURCHASE_TOKEN");

    const other = createTestAccount("other", "other@test.com");
    const stolen = await invoke(router, "POST", "/verify", {
      cookie: other.cookie,
      body: { productId: "badge_coral", purchaseToken: "tok-1" },
    });
    assert.equal(stolen.status, 409);
    assert.equal(stolen.body.code, "PURCHASE_ALREADY_CLAIMED");

    google.failWith = 500;
    const down = await invoke(router, "POST", "/verify", {
      cookie: account.cookie,
      body: { productId: "theme_night", purchaseToken: "tok-2" },
    });
    assert.equal(down.status, 502);
    assert.equal(down.body.code, "GOOGLE_PLAY_UNAVAILABLE");
  });

  test("POST /restore verifies each token and reports per-token results", async () => {
    const account = createTestAccount("player", "player@test.com");
    const playerId = account.player.playerId;
    google.addProduct("tok-a", "theme_night");
    google.addSubscription("sub-1", "SUBSCRIPTION_STATE_ACTIVE", {
      externalAccountIdentifiers: { obfuscatedExternalAccountId: playAccountIdFor(playerId) },
    });

    const result = await invoke(router, "POST", "/restore", {
      cookie: account.cookie,
      body: {
        purchases: [
          { productId: "theme_night", purchaseToken: "tok-a" },
          { productId: "sub_patron", purchaseToken: "sub-1" },
          { productId: "badge_coral", purchaseToken: "missing" },
          { nonsense: true },
        ],
      },
    });
    assert.equal(result.status, 200);
    assert.deepEqual(
      result.body.results.map((r: { status: string; code?: string }) => r.code ?? r.status),
      ["granted", "granted", "INVALID_PURCHASE_TOKEN", "INVALID_PURCHASE"],
    );
    assert.ok(store.account(playerId).themes.has("night"));
    assert.ok(store.account(playerId).badges.has("patron"));

    const tooMany = await invoke(router, "POST", "/restore", {
      cookie: account.cookie,
      body: { purchases: Array.from({ length: 51 }, () => ({})) },
    });
    assert.equal(tooMany.status, 400);
  });

  test("POST /rtdn refuses deliveries until push auth is configured", async () => {
    const result = await invoke(router, "POST", "/rtdn", {
      body: encodeNotification({ testNotification: { version: "1.0" } }),
    });
    assert.equal(result.status, 503);
  });

  test("POST /rtdn authenticates with the shared token and applies the notification", async () => {
    process.env.GOOGLE_PLAY_RTDN_TOKEN = "push-secret";
    const playerId = "64b000000000000000000009";
    store.playAccountIds.set(playAccountIdFor(playerId), playerId);
    google.addProduct("tok-r", "theme_marble", {
      obfuscatedExternalAccountId: playAccountIdFor(playerId),
    });
    const body = encodeNotification({
      oneTimeProductNotification: {
        notificationType: 1,
        purchaseToken: "tok-r",
        sku: "theme_marble",
      },
    });

    const denied = await invoke(router, "POST", "/rtdn", { body, query: { token: "wrong" } });
    assert.equal(denied.status, 401);
    assert.equal(store.account(playerId).themes.size, 0);

    const ok = await invoke(router, "POST", "/rtdn", { body, query: { token: "push-secret" } });
    assert.equal(ok.status, 204);
    assert.ok(store.account(playerId).themes.has("marble"));

    // Garbage payloads are acked so Pub/Sub stops redelivering them.
    const garbage = await invoke(router, "POST", "/rtdn", {
      body: { message: { data: "!!!not-base64-json" } },
      query: { token: "push-secret" },
    });
    assert.equal(garbage.status, 204);

    // Transient Google failure → non-2xx so Pub/Sub retries.
    google.failWith = 503;
    const retry = await invoke(router, "POST", "/rtdn", { body, query: { token: "push-secret" } });
    assert.equal(retry.status, 500);
  });

  test("Stripe cancel refuses Google Play subscriptions", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    const account = createTestAccount("player", "player@test.com");
    const subscriptionId = playSubscriptionId("sub-1");
    mockAccounts.set(account.player.playerId, {
      activeSubscriptions: [
        {
          subscriptionId,
          badgeId: "patron",
          status: "active",
          currentPeriodEnd: new Date(),
          provider: "google_play",
        },
      ],
      save: async () => {},
    });
    const result = await invoke(shopRouter, "POST", "/cancel-subscription", {
      cookie: account.cookie,
      body: { subscriptionId },
    });
    assert.equal(result.status, 409);
    assert.equal(result.body.code, "MANAGED_BY_GOOGLE_PLAY");
  });
});
