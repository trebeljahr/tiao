process.env.TOKEN_SECRET = "test-secret";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/tiao-test";
process.env.S3_BUCKET_NAME = "tiao-test-assets";
process.env.S3_PUBLIC_URL = "https://assets.test.local";
process.env.NODE_ENV = "test";

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { Request, Response, Router } from "express";
import mongoose from "mongoose";
import GameAccount from "../models/GameAccount";
import {
  createTestAccount,
  createTestGuest,
  installTestSessionMock,
  resetTestSessions,
} from "./testAuthHelper";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TestRouter = Router & {
  stack: Array<{
    route?: {
      path: string;
      methods: Record<string, boolean>;
      stack: Array<{ handle: (req: Request, res: Response, next: () => void) => void }>;
    };
  }>;
};

// Cast router to work around Express IRoute type not exposing `methods` and `stack`
function asTestRouter(r: Router): TestRouter {
  return r as unknown as TestRouter;
}

type RouteResult<T = unknown> = { status: number; body: T; headers: Map<string, string> };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockResponse<T = unknown>(): { _result: RouteResult<T> } {
  const result: RouteResult<T> = { status: 200, body: {} as T, headers: new Map() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = {
    _result: result,
    statusCode: 200,
    status(code: number) {
      result.status = code;
      res.statusCode = code;
      return res;
    },
    json(payload: T) {
      result.body = payload;
      return res;
    },
    send(payload: T) {
      result.body = payload;
      return res;
    },
    setHeader(name: string, value: string) {
      result.headers.set(name.toLowerCase(), value);
      return res;
    },
    getHeader(name: string) {
      return result.headers.get(name.toLowerCase());
    },
  };
  return res;
}

type Handler = (req: unknown, res: unknown, next: (err?: unknown) => void) => unknown;

async function runHandler(handler: Handler, req: unknown, res: unknown) {
  return new Promise<void>((resolve, reject) => {
    const result = handler(req, res, (err?: unknown) => {
      if (err) reject(err);
      else resolve();
    });
    if (
      result &&
      typeof result === "object" &&
      typeof (result as { then?: unknown }).then === "function"
    ) {
      (result as Promise<unknown>).then(() => resolve(), reject);
    }
  });
}

async function invokeRoute<T = unknown>(
  router: TestRouter,
  method: string,
  path: string,
  options: { cookie?: string; body?: unknown } = {},
): Promise<RouteResult<T>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stack = (router as any).stack as any[];
  const layer = stack.find(
    (l: any) => l.route?.path === path && l.route.methods[method.toLowerCase()],
  );
  if (!layer?.route) throw new Error(`Route ${method} ${path} not found`);

  const req = {
    method: method.toUpperCase(),
    path,
    url: path,
    params: {},
    query: {},
    body: options.body ?? {},
    headers: {
      cookie: options.cookie ?? "",
      host: "localhost:5005",
    },
    get(name: string) {
      if (name === "host") return "localhost:5005";
      return undefined;
    },
    protocol: "http",
  } as unknown as Request;

  const res = createMockResponse<T>();

  for (const handler of layer.route.stack) {
    await runHandler(handler.handle as Handler, req, res);
  }

  return res._result;
}

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const mockAccounts = new Map<string, Record<string, unknown>>();

function createMockAccount(
  id: string,
  displayName: string,
  badges: string[] = [],
  themes: string[] = [],
) {
  const doc = {
    _id: id,
    id,
    displayName,
    badges,
    activeBadges: [],
    unlockedThemes: themes,
    save: async () => {},
  };
  mockAccounts.set(id, doc);
  return doc;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Shop routes", () => {
  let router: TestRouter;

  beforeEach(async () => {
    resetTestSessions();
    await installTestSessionMock();
    mockAccounts.clear();

    // Patch GameAccount
    (GameAccount as unknown as Record<string, unknown>).findById = async (id: string) =>
      mockAccounts.get(id) ?? null;

    // Patch mongoose readyState AND db — without a db stub, any Mongoose
    // model compiled AFTER readyState flips to 1 crashes because the
    // Collection constructor sees "connected" and calls
    // `this.conn.db.collection(this.name)` on an undefined `db`. The
    // subsequent `await import("../routes/shop.routes")` transitively
    // loads server/models/GameRoom.ts, whose top-level
    // `mongoose.model("GameRoom", schema)` call triggers the crash.
    Object.defineProperty(mongoose.connection, "readyState", {
      get: () => 1,
      configurable: true,
    });
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

    // Delete Stripe env so getStripe() returns null by default
    delete process.env.STRIPE_SECRET_KEY;

    const mod = await import("../routes/shop.routes");
    router = asTestRouter(mod.default);
  });

  afterEach(() => {
    resetTestSessions();
  });

  // ── GET /catalog ──

  describe("GET /catalog", () => {
    test("returns catalog without auth (guest browsing)", async () => {
      const result = await invokeRoute(router, "GET", "/catalog");
      assert.equal(result.status, 200);
      assert.ok(Array.isArray((result.body as { catalog: unknown[] }).catalog));
      const catalog = (result.body as { catalog: { type: string; id: string; owned: boolean }[] })
        .catalog;
      assert.ok(catalog.length > 0);
      // All items should be unowned for unauthenticated user
      assert.ok(catalog.every((item) => item.owned === false));
    });

    test("returns catalog with owned items for account user", async () => {
      const account = createTestAccount("shopuser", "shop@test.com");
      createMockAccount(account.player.playerId, "shopuser", ["supporter"], ["night"]);

      const result = await invokeRoute(router, "GET", "/catalog", {
        cookie: account.cookie,
      });
      assert.equal(result.status, 200);
      const catalog = (result.body as { catalog: { type: string; id: string; owned: boolean }[] })
        .catalog;

      const supporterBadge = catalog.find((i) => i.type === "badge" && i.id === "supporter");
      assert.ok(supporterBadge?.owned, "supporter badge should be owned");

      const nightTheme = catalog.find((i) => i.type === "theme" && i.id === "night");
      assert.ok(nightTheme?.owned, "night theme should be owned");

      const contributorBadge = catalog.find((i) => i.type === "badge" && i.id === "contributor");
      assert.ok(!contributorBadge?.owned, "contributor badge should not be owned");
    });

    test("returns catalog for guest user (browsing)", async () => {
      const guest = createTestGuest("Guest");
      const result = await invokeRoute(router, "GET", "/catalog", {
        cookie: guest.cookie,
      });
      assert.equal(result.status, 200);
      const catalog = (result.body as { catalog: { owned: boolean }[] }).catalog;
      assert.ok(catalog.every((item) => item.owned === false));
    });
  });

  // ── POST /checkout ──

  describe("POST /checkout", () => {
    test("returns 401 without auth", async () => {
      const result = await invokeRoute(router, "POST", "/checkout", {
        body: { itemType: "badge", itemId: "supporter" },
      });
      assert.equal(result.status, 401);
    });

    test("returns 401 for guest user", async () => {
      const guest = createTestGuest("Guest");
      const result = await invokeRoute(router, "POST", "/checkout", {
        cookie: guest.cookie,
        body: { itemType: "badge", itemId: "supporter" },
      });
      assert.equal(result.status, 401);
    });

    test("returns 503 when Stripe is not configured", async () => {
      const account = createTestAccount("buyer", "buyer@test.com");
      createMockAccount(account.player.playerId, "buyer");

      const result = await invokeRoute(router, "POST", "/checkout", {
        cookie: account.cookie,
        body: { itemType: "badge", itemId: "supporter" },
      });
      assert.equal(result.status, 503);
      assert.equal((result.body as { code: string }).code, "STRIPE_NOT_CONFIGURED");
    });

    test("returns 400 for missing itemType/itemId", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_fake";
      const account = createTestAccount("buyer", "buyer@test.com");
      createMockAccount(account.player.playerId, "buyer");

      const result = await invokeRoute(router, "POST", "/checkout", {
        cookie: account.cookie,
        body: {},
      });
      assert.equal(result.status, 400);
    });

    test("returns 404 for non-existent item", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_fake";
      const account = createTestAccount("buyer", "buyer@test.com");
      createMockAccount(account.player.playerId, "buyer");

      const result = await invokeRoute(router, "POST", "/checkout", {
        cookie: account.cookie,
        body: { itemType: "badge", itemId: "nonexistent" },
      });
      assert.equal(result.status, 404);
    });

    test("returns 409 for already owned item", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_fake";
      const account = createTestAccount("buyer", "buyer@test.com");
      createMockAccount(account.player.playerId, "buyer", ["supporter"]);

      const result = await invokeRoute(router, "POST", "/checkout", {
        cookie: account.cookie,
        body: { itemType: "badge", itemId: "supporter" },
      });
      assert.equal(result.status, 409);
      assert.equal((result.body as { code: string }).code, "ALREADY_OWNED");
    });
  });
});
