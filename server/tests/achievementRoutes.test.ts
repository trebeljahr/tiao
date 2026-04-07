process.env.TOKEN_SECRET = "test-secret";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/tiao-test";
process.env.S3_BUCKET_NAME = "tiao-test-assets";
process.env.S3_PUBLIC_URL = "https://assets.test.local";
process.env.NODE_ENV = "test";

import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Router, Request, Response } from "express";
import {
  createTestAccount,
  createTestGuest,
  resetTestSessions,
  installTestSessionMock,
} from "./testAuthHelper";
import GameAccount from "../models/GameAccount";
import Achievement from "../models/Achievement";
import mongoose from "mongoose";

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

type RouteResult<T = unknown> = { status: number; body: T; headers: Map<string, string> };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockResponse<T = unknown>() {
  const result: RouteResult<T> = { status: 200, body: {} as T, headers: new Map() };
  const res = {
    _result: result,
    statusCode: 200,
    status(code: number) {
      result.status = code;
      this.statusCode = code;
      return this;
    },
    json(payload: T) {
      result.body = payload;
      return this;
    },
    send(payload: T) {
      result.body = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      result.headers.set(name.toLowerCase(), value);
      return this;
    },
    getHeader(name: string) {
      return result.headers.get(name.toLowerCase());
    },
  };
  return res;
}

async function runHandler(handler: Function, req: unknown, res: unknown) {
  return new Promise<void>((resolve, reject) => {
    const result = handler(req, res, (err?: unknown) => {
      if (err) reject(err);
      else resolve();
    });
    if (result && typeof result.then === "function") {
      result.then(resolve, reject);
    }
  });
}

async function invokeRoute<T = unknown>(
  router: TestRouter,
  method: string,
  path: string,
  options: { cookie?: string; body?: unknown; params?: Record<string, string> } = {},
): Promise<RouteResult<T>> {
  // Match route path patterns like /profile/:username/achievements
  const layer = router.stack.find((l) => {
    if (!l.route) return false;
    const route = l.route as unknown as {
      path: string;
      methods: Record<string, boolean>;
      stack: Array<{ handle: Function }>;
    };
    if (!route.methods[method.toLowerCase()]) return false;

    const routeParts = route.path.split("/");
    const pathParts = path.split("/");
    if (routeParts.length !== pathParts.length) return false;

    return routeParts.every((part, i) => part.startsWith(":") || part === pathParts[i]);
  });
  const route = layer?.route as unknown as
    | { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> }
    | undefined;
  if (!route) throw new Error(`Route ${method} ${path} not found`);

  // Extract params from path
  const routeParts = route.path.split("/");
  const pathParts = path.split("/");
  const params: Record<string, string> = { ...options.params };
  routeParts.forEach((part, i) => {
    if (part.startsWith(":")) {
      params[part.slice(1)] = pathParts[i]!;
    }
  });

  const req = {
    method: method.toUpperCase(),
    path,
    url: path,
    params,
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

  for (const handler of route.stack) {
    await runHandler(handler.handle, req, res);
  }

  return res._result;
}

// ---------------------------------------------------------------------------
// Mock data stores
// ---------------------------------------------------------------------------

const mockAccounts = new Map<string, Record<string, unknown>>();
const mockAchievements: Array<{ playerId: string; achievementId: string; unlockedAt: Date }> = [];

function createMockAccount(id: string, displayName: string) {
  const doc = {
    _id: id,
    id,
    displayName,
    badges: [],
    activeBadges: [],
    rating: { overall: { elo: 1500, gamesPlayed: 0 } },
    save: async () => {},
  };
  mockAccounts.set(id, doc);
  return doc;
}

function addMockAchievement(playerId: string, achievementId: string) {
  mockAchievements.push({
    playerId,
    achievementId,
    unlockedAt: new Date("2025-01-15T10:00:00Z"),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Achievement routes", () => {
  let router: TestRouter;

  beforeEach(async () => {
    resetTestSessions();
    await installTestSessionMock();
    mockAccounts.clear();
    mockAchievements.length = 0;

    // Patch GameAccount.findOne for profile lookup
    (GameAccount as unknown as Record<string, unknown>).findOne = async (
      query: Record<string, unknown>,
    ) => {
      for (const [, acc] of mockAccounts) {
        const displayNameQuery = query?.displayName as Record<string, unknown> | undefined;
        if (
          displayNameQuery?.$regex &&
          (displayNameQuery.$regex as RegExp).test(acc.displayName as string)
        ) {
          return acc;
        }
      }
      return null;
    };

    // Patch Achievement model
    (Achievement as unknown as Record<string, unknown>).find = (
      query: Record<string, unknown>,
    ) => ({
      lean: () => mockAchievements.filter((a) => a.playerId === (query?.playerId ?? "")),
    });

    (Achievement as unknown as Record<string, unknown>).create = async (
      doc: Record<string, unknown>,
    ) => {
      // Check for duplicate
      const exists = mockAchievements.some(
        (a) => a.playerId === doc.playerId && a.achievementId === doc.achievementId,
      );
      if (exists) {
        const err = new Error("duplicate") as Error & { code: number };
        err.code = 11000;
        throw err;
      }
      mockAchievements.push({
        playerId: doc.playerId as string,
        achievementId: doc.achievementId as string,
        unlockedAt: new Date(),
      });
      return doc;
    };

    // Patch mongoose readyState
    Object.defineProperty(mongoose.connection, "readyState", {
      get: () => 1,
      configurable: true,
    });

    // Mock the achievement notifier to be a no-op (prevents broadcastLobby calls)
    const achievementService = await import("../game/achievementService");
    achievementService.setAchievementNotifier(() => {});

    const mod = await import("../routes/achievement.routes");
    router = mod.default as unknown as TestRouter;
  });

  afterEach(() => {
    resetTestSessions();
  });

  // ── GET /achievements ──

  describe("GET /achievements", () => {
    test("returns 401 without auth", async () => {
      const result = await invokeRoute(router, "GET", "/achievements");
      assert.equal(result.status, 401);
    });

    test("returns 401 for guest user", async () => {
      const guest = createTestGuest("Guest");
      const result = await invokeRoute(router, "GET", "/achievements", {
        cookie: guest.cookie,
      });
      assert.equal(result.status, 401);
    });

    test("returns empty achievements for new account", async () => {
      const account = createTestAccount("achiever", "ach@test.com");
      createMockAccount(account.player.playerId, "achiever");

      const result = await invokeRoute<{
        achievements: unknown[];
        definitions: unknown[];
      }>(router, "GET", "/achievements", {
        cookie: account.cookie,
      });
      assert.equal(result.status, 200);
      assert.ok(Array.isArray(result.body.achievements));
      assert.equal(result.body.achievements.length, 0);
      assert.ok(Array.isArray(result.body.definitions));
      assert.ok(result.body.definitions.length > 0, "should include definitions");
    });

    test("returns unlocked achievements for account", async () => {
      const account = createTestAccount("veteran", "vet@test.com");
      createMockAccount(account.player.playerId, "veteran");
      addMockAchievement(account.player.playerId, "first-move");
      addMockAchievement(account.player.playerId, "tutorial-complete");

      const result = await invokeRoute<{
        achievements: Array<{ achievementId: string; unlockedAt: string }>;
      }>(router, "GET", "/achievements", {
        cookie: account.cookie,
      });
      assert.equal(result.status, 200);
      assert.equal(result.body.achievements.length, 2);
      const ids = result.body.achievements.map((a) => a.achievementId);
      assert.ok(ids.includes("first-move"));
      assert.ok(ids.includes("tutorial-complete"));
    });
  });

  // ── GET /profile/:username/achievements ──

  describe("GET /profile/:username/achievements", () => {
    test("returns 404 for unknown player", async () => {
      const result = await invokeRoute<{ error: string }>(
        router,
        "GET",
        "/profile/nobody/achievements",
      );
      assert.equal(result.status, 404);
    });

    test("returns achievements for existing player (no auth required)", async () => {
      const id = "mock-player-id";
      createMockAccount(id, "publicplayer");
      addMockAchievement(id, "speed-demon");

      // Override findOne to return this specific account
      (GameAccount as unknown as Record<string, unknown>).findOne = async () =>
        mockAccounts.get(id);

      const result = await invokeRoute<{
        achievements: Array<{ achievementId: string }>;
      }>(router, "GET", "/profile/publicplayer/achievements");
      assert.equal(result.status, 200);
      assert.equal(result.body.achievements.length, 1);
      assert.equal(result.body.achievements[0]!.achievementId, "speed-demon");
    });
  });

  // ── POST /achievements/ai-win ──

  describe("POST /achievements/ai-win", () => {
    test("returns 401 without auth", async () => {
      const result = await invokeRoute(router, "POST", "/achievements/ai-win", {
        body: { difficulty: 1 },
      });
      assert.equal(result.status, 401);
    });

    test("returns 401 for guest user", async () => {
      const guest = createTestGuest("Guest");
      const result = await invokeRoute(router, "POST", "/achievements/ai-win", {
        cookie: guest.cookie,
        body: { difficulty: 1 },
      });
      assert.equal(result.status, 401);
    });

    test("returns 400 for invalid difficulty", async () => {
      const account = createTestAccount("player", "p@test.com");
      createMockAccount(account.player.playerId, "player");

      const result = await invokeRoute<{ error: string }>(router, "POST", "/achievements/ai-win", {
        cookie: account.cookie,
        body: { difficulty: 5 },
      });
      assert.equal(result.status, 400);
    });

    test("grants AI achievement for valid difficulty", async () => {
      const account = createTestAccount("aiplayer", "ai@test.com");
      createMockAccount(account.player.playerId, "aiplayer");

      const result = await invokeRoute<{ ok: boolean }>(router, "POST", "/achievements/ai-win", {
        cookie: account.cookie,
        body: { difficulty: 2 },
      });
      assert.equal(result.status, 200);
      assert.equal(result.body.ok, true);

      // Verify achievement was stored
      const stored = mockAchievements.find(
        (a) => a.playerId === account.player.playerId && a.achievementId === "ai-medium",
      );
      assert.ok(stored, "ai-medium achievement should be stored");
    });

    test("handles duplicate AI win gracefully", async () => {
      const account = createTestAccount("repeat", "rep@test.com");
      createMockAccount(account.player.playerId, "repeat");

      // First win
      await invokeRoute(router, "POST", "/achievements/ai-win", {
        cookie: account.cookie,
        body: { difficulty: 1 },
      });

      // Second win (duplicate) — should not error
      const result = await invokeRoute<{ ok: boolean }>(router, "POST", "/achievements/ai-win", {
        cookie: account.cookie,
        body: { difficulty: 1 },
      });
      assert.equal(result.status, 200);
      assert.equal(result.body.ok, true);
    });
  });
});
