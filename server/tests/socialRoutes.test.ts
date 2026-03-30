import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import mongoose from "mongoose";
import { createTestAccount, resetTestSessions, installTestSessionMock } from "./testAuthHelper";

process.env.TOKEN_SECRET ??= "test-token-secret";
process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/tiao-test";
process.env.S3_BUCKET_NAME ??= "tiao-test-assets";
process.env.S3_PUBLIC_URL ??= "https://assets.test.local";

// ─── Router + route harness types ────────────────────────────────────

type TestRouter = {
  stack: Array<{
    route?: {
      path: string;
      methods: Record<string, boolean>;
      stack: Array<{
        handle: (
          req: Record<string, unknown>,
          res: Record<string, unknown>,
          next: (error?: unknown) => void,
        ) => unknown;
      }>;
    };
  }>;
};

type RouteResult<T> = {
  status: number;
  body: T;
  headers: Record<string, string | string[]>;
};

function createMockResponse<T>(): Record<string, unknown> & {
  statusCode: number;
  body: T;
  headers: Record<string, string | string[]>;
} {
  return {
    statusCode: 200,
    body: undefined as T,
    headers: {},
    locals: {},
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: T) {
      this.body = payload;
      return this;
    },
    send(payload?: T) {
      this.body = payload as T;
      return this;
    },
    setHeader(name: string, value: string | string[]) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    getHeader(name: string) {
      return this.headers[name.toLowerCase()];
    },
  };
}

async function runHandler(
  handler: (
    req: Record<string, unknown>,
    res: Record<string, unknown>,
    next: (error?: unknown) => void,
  ) => unknown,
  req: Record<string, unknown>,
  res: Record<string, unknown>,
) {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const next = (error?: unknown) => {
      settled = true;
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };

    try {
      const returned = handler(req, res, next);
      if (
        returned &&
        typeof returned === "object" &&
        "then" in returned &&
        typeof returned.then === "function"
      ) {
        returned
          .then(() => {
            if (!settled) resolve();
          })
          .catch(reject);
      } else if (handler.length < 3) {
        resolve();
      }
    } catch (error) {
      reject(error);
    }
  });
}

async function invokeRoute<T>(
  router: TestRouter,
  options: {
    method: "get" | "post" | "delete";
    path: string;
    params?: Record<string, string>;
    query?: Record<string, string>;
    cookie?: string;
    body?: Record<string, unknown>;
  },
): Promise<RouteResult<T>> {
  const layer = router.stack.find(
    (entry) => entry.route?.path === options.path && entry.route.methods[options.method],
  );

  assert.ok(layer?.route, `Route ${options.method.toUpperCase()} ${options.path} should exist.`);

  const req = {
    method: options.method.toUpperCase(),
    url: options.path,
    params: options.params ?? {},
    query: options.query ?? {},
    headers: options.cookie ? { cookie: options.cookie } : {},
    body: options.body ?? {},
  };
  const res = createMockResponse<T>();

  for (const routeLayer of layer!.route!.stack) {
    await runHandler(routeLayer.handle, req, res);
  }

  return {
    status: res.statusCode,
    body: res.body,
    headers: res.headers,
  };
}

// ─── Mock infrastructure ─────────────────────────────────────────────

/**
 * In-memory store for mock GameAccount documents.
 * Each entry simulates a Mongoose document with .save(), .id, ._id, etc.
 */
const mockAccounts = new Map<string, Record<string, unknown>>();
const mockInvitations = new Map<string, Record<string, unknown>>();
let mockReadyState = 1;

function createMockAccount(
  id: string,
  displayName: string,
  options: {
    friends?: string[];
    sentFriendRequests?: string[];
    receivedFriendRequests?: string[];
    email?: string;
    profilePicture?: string;
    rating?: { overall: { elo: number; gamesPlayed: number } };
    activeBadges?: string[];
  } = {},
) {
  const toObjectId = (s: string) => {
    // Return an object with toString() to simulate ObjectId behavior
    return { toString: () => s, _bsontype: "ObjectId" };
  };

  const account: Record<string, unknown> = {
    _id: toObjectId(id),
    id,
    displayName,
    email: options.email,
    profilePicture: options.profilePicture,
    friends: (options.friends ?? []).map(toObjectId),
    sentFriendRequests: (options.sentFriendRequests ?? []).map(toObjectId),
    receivedFriendRequests: (options.receivedFriendRequests ?? []).map(toObjectId),
    rating: options.rating ?? { overall: { elo: 1500, gamesPlayed: 0 } },
    activeBadges: options.activeBadges ?? [],
    hasSeenTutorial: false,
    badges: [],
    isAdmin: false,
    bio: "",
    save: async () => {},
  };
  mockAccounts.set(id, account);
  return account;
}

function createMockInvitation(
  id: string,
  props: {
    gameId: string;
    senderId: string;
    recipientId: string;
    status: string;
    roomType?: string;
    expiresAt?: Date;
  },
) {
  const toObjectId = (s: string) => ({ toString: () => s, _bsontype: "ObjectId" });
  const invitation: Record<string, unknown> = {
    _id: toObjectId(id),
    id,
    gameId: props.gameId,
    senderId: toObjectId(props.senderId),
    recipientId: toObjectId(props.recipientId),
    status: props.status,
    roomType: props.roomType ?? "direct",
    expiresAt: props.expiresAt ?? new Date(Date.now() + 3600_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    save: async () => {},
  };
  mockInvitations.set(id, invitation);
  return invitation;
}

let socialRoutes: TestRouter;
let originalFindById: unknown;
let originalFind: unknown;
let originalUpdateMany: unknown;
let originalInvFindOne: unknown;
let originalInvFind: unknown;
let originalInvCreate: unknown;
let originalInvUpdateMany: unknown;

/**
 * Install mocks on the Mongoose models used by social.routes.ts.
 * This avoids needing a real MongoDB connection for unit tests.
 */
async function installModelMocks() {
  const GameAccount = (await import("../models/GameAccount")).default;
  const GameInvitation = (await import("../models/GameInvitation")).default;

  // Save originals
  originalFindById = GameAccount.findById;
  originalFind = GameAccount.find;
  originalUpdateMany = GameInvitation.updateMany;
  originalInvFindOne = GameInvitation.findOne;
  originalInvFind = GameInvitation.find;
  originalInvCreate = GameInvitation.create;
  originalInvUpdateMany = GameInvitation.updateMany;

  // Mock GameAccount.findById
  (GameAccount as unknown as Record<string, unknown>).findById = (id: string) => {
    const account = mockAccounts.get(id);
    return account ?? null;
  };

  // Mock GameAccount.find - returns a chainable query-like object
  (GameAccount as unknown as Record<string, unknown>).find = (_filter: Record<string, unknown>) => {
    const results = Array.from(mockAccounts.values());
    return {
      sort: () => ({
        limit: () => ({
          lean: () => ({
            exec: async () => results,
          }),
        }),
        lean: () => ({
          exec: async () => results,
        }),
      }),
    };
  };

  // Mock GameInvitation.updateMany (expireStaleInvitations) - no-op
  (GameInvitation as unknown as Record<string, unknown>).updateMany = async () => ({
    modifiedCount: 0,
  });

  // Mock GameInvitation.findOne
  (GameInvitation as unknown as Record<string, unknown>).findOne = (
    filter: Record<string, unknown>,
  ) => {
    for (const inv of mockInvitations.values()) {
      const id = filter._id;
      const idStr = id?.toString?.() ?? String(id);
      if (
        (inv as Record<string, unknown>).id === idStr &&
        (inv as Record<string, unknown>).status ===
          (filter.status ?? (inv as Record<string, unknown>).status)
      ) {
        // Check senderId/recipientId if specified
        if (filter.senderId) {
          const senderIdStr =
            ((inv as Record<string, unknown>).senderId as { toString(): string })?.toString() ?? "";
          const filterSenderStr =
            (filter.senderId as { toString(): string })?.toString() ?? String(filter.senderId);
          if (senderIdStr !== filterSenderStr) continue;
        }
        if (filter.recipientId) {
          const recipientIdStr =
            ((inv as Record<string, unknown>).recipientId as { toString(): string })?.toString() ??
            "";
          const filterRecipientStr =
            (filter.recipientId as { toString(): string })?.toString() ??
            String(filter.recipientId);
          if (recipientIdStr !== filterRecipientStr) continue;
        }
        return inv;
      }
    }
    return null;
  };

  // Mock GameInvitation.find - returns chainable query
  (GameInvitation as unknown as Record<string, unknown>).find = () => ({
    populate: () => ({
      populate: () => ({
        sort: () => ({
          limit: () => ({
            exec: async () => [],
          }),
        }),
      }),
    }),
  });

  // Mock GameInvitation.create
  (GameInvitation as unknown as Record<string, unknown>).create = async () => ({});

  // Patch mongoose.connection.readyState
  Object.defineProperty(mongoose.connection, "readyState", {
    get: () => mockReadyState,
    configurable: true,
  });
}

function restoreModelMocks() {
  // Models are cached by Mongoose, so restoring is important
  // In practice, since tests run in isolation per file, this is a safety measure
  mockAccounts.clear();
  mockInvitations.clear();
  mockReadyState = 1;
}

// Also need to mock fetchSsoProfilePictures, gameService, GameRoom, and notifyLobbyUpdate
async function installServiceMocks() {
  const ssoModule = (await import("../auth/ssoProfilePicture")) as Record<string, unknown>;
  ssoModule.fetchSsoProfilePictures = async () => new Map<string, string>();

  const gameServiceModule = (await import("../game/gameService")) as Record<string, unknown>;
  const mockGameService: Record<string, unknown> = {
    isPlayerConnectedToLobby: () => false,
    broadcastLobby: () => {},
    getSnapshot: async (gameId: string) => ({
      gameId,
      roomType: "direct",
      status: "waiting",
      players: [],
    }),
    listActiveGamesForPlayer: async () => [],
  };
  gameServiceModule.gameService = mockGameService;

  // Mock GameRoom.find to prevent Mongoose buffering timeouts
  const GameRoom = (await import("../models/GameRoom")).default;
  (GameRoom as unknown as Record<string, unknown>).find = () => ({
    lean: () => [],
  });

  // Mock notifyLobbyUpdate to be a no-op (prevents fire-and-forget Mongoose calls)
  const socialModule = (await import("../routes/social.routes")) as Record<string, unknown>;
  socialModule.notifyLobbyUpdate = async () => {};
}

// ─── Test setup ──────────────────────────────────────────────────────

beforeEach(async () => {
  resetTestSessions();
  await installTestSessionMock();
  await installModelMocks();
  await installServiceMocks();

  // Import the social routes module fresh - note: module caching means
  // the mocks must be installed before importing
  const socialRoutesModule = await import("../routes/social.routes");
  socialRoutes = socialRoutesModule.default as TestRouter;
});

afterEach(() => {
  resetTestSessions();
  restoreModelMocks();
});

// ─── GET /player/social/overview ────────────────────────────────────

describe("GET /player/social/overview", () => {
  test("returns 401 without session cookie", async () => {
    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "get",
      path: "/player/social/overview",
    });

    assert.equal(response.status, 401);
    assert.match(response.body.message, /not authenticated/i);
  });

  test("returns 403 for guest user", async () => {
    const { createTestGuest } = await import("./testAuthHelper");
    const guest = createTestGuest("Guest Player");

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "get",
      path: "/player/social/overview",
      cookie: guest.cookie,
    });

    assert.equal(response.status, 403);
  });

  test("returns 404 when account not found in database", async () => {
    // Create a session for an account whose playerId does not exist in mockAccounts
    const account = createTestAccount("Ghost", "ghost@example.com");

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "get",
      path: "/player/social/overview",
      cookie: account.cookie,
    });

    assert.equal(response.status, 404);
    assert.match(response.body.message, /could not be found/i);
  });

  test("returns 503 when database is not ready", async () => {
    mockReadyState = 0;
    const account = createTestAccount("User", "user@example.com");

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "get",
      path: "/player/social/overview",
      cookie: account.cookie,
    });

    assert.equal(response.status, 503);
    assert.match(response.body.message, /unavailable/i);
  });

  test("returns overview with empty lists for account with no social data", async () => {
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice", { email: "alice@example.com" });

    const response = await invokeRoute<{
      overview: {
        friends: unknown[];
        incomingFriendRequests: unknown[];
        outgoingFriendRequests: unknown[];
        incomingInvitations: unknown[];
        outgoingInvitations: unknown[];
      };
    }>(socialRoutes, {
      method: "get",
      path: "/player/social/overview",
      cookie: account.cookie,
    });

    assert.equal(response.status, 200);
    assert.ok(response.body.overview);
    assert.ok(Array.isArray(response.body.overview.friends));
    assert.ok(Array.isArray(response.body.overview.incomingFriendRequests));
    assert.ok(Array.isArray(response.body.overview.outgoingFriendRequests));
    assert.ok(Array.isArray(response.body.overview.incomingInvitations));
    assert.ok(Array.isArray(response.body.overview.outgoingInvitations));
  });
});

// ─── GET /player/social/search ──────────────────────────────────────

describe("GET /player/social/search", () => {
  test("returns 401 without session cookie", async () => {
    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "get",
      path: "/player/social/search",
      query: { q: "test" },
    });

    assert.equal(response.status, 401);
  });

  test("returns 400 when query is missing", async () => {
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice");

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "get",
      path: "/player/social/search",
      cookie: account.cookie,
    });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /search query/i);
  });

  test("returns 400 when query is too short", async () => {
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice");

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "get",
      path: "/player/social/search",
      query: { q: "a" },
      cookie: account.cookie,
    });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /at least 2 characters/i);
  });

  test("returns 200 with results array for valid query", async () => {
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice");

    const response = await invokeRoute<{ results: unknown[] }>(socialRoutes, {
      method: "get",
      path: "/player/social/search",
      query: { q: "Bob" },
      cookie: account.cookie,
    });

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body.results));
  });
});

// ─── POST /player/social/friend-requests ────────────────────────────

describe("POST /player/social/friend-requests", () => {
  test("returns 401 without session cookie", async () => {
    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "post",
      path: "/player/social/friend-requests",
      body: { accountId: "000000000000000000000001" },
    });

    assert.equal(response.status, 401);
  });

  test("returns 400 when accountId is missing", async () => {
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice");

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "post",
      path: "/player/social/friend-requests",
      cookie: account.cookie,
      body: {},
    });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /choose a player/i);
  });

  test("returns 400 when accountId is not a valid ObjectId", async () => {
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice");

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "post",
      path: "/player/social/friend-requests",
      cookie: account.cookie,
      body: { accountId: "not-a-valid-id" },
    });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /choose a player/i);
  });

  test("returns 400 when trying to add yourself", async () => {
    const aliceId = "000000000000000000000001";
    const account = createTestAccount("Alice", "alice@example.com");
    const mockAccount = createMockAccount(account.player.playerId, "Alice");
    // Override .id to match the accountId we'll send
    mockAccount.id = aliceId;
    mockAccount._id = { toString: () => aliceId, _bsontype: "ObjectId" };
    mockAccounts.delete(account.player.playerId);
    mockAccounts.set(account.player.playerId, mockAccount);

    // Re-mock findById to also find by aliceId
    const GameAccount = (await import("../models/GameAccount")).default;
    (GameAccount as unknown as Record<string, unknown>).findById = (id: string) => {
      if (id === account.player.playerId) return mockAccount;
      if (id === aliceId) return mockAccount;
      return mockAccounts.get(id) ?? null;
    };

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "post",
      path: "/player/social/friend-requests",
      cookie: account.cookie,
      body: { accountId: aliceId },
    });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /yourself/i);
  });

  test("returns 404 when target account does not exist", async () => {
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice");

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "post",
      path: "/player/social/friend-requests",
      cookie: account.cookie,
      body: { accountId: "000000000000000000000099" },
    });

    assert.equal(response.status, 404);
    assert.match(response.body.message, /could not be found/i);
  });

  test("returns 409 when already friends", async () => {
    const bobId = "000000000000000000000002";
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice", { friends: [bobId] });
    const bobAccount = createMockAccount(bobId, "Bob", { friends: [account.player.playerId] });

    const GameAccount = (await import("../models/GameAccount")).default;
    (GameAccount as unknown as Record<string, unknown>).findById = (id: string) => {
      if (id === account.player.playerId) return mockAccounts.get(account.player.playerId) ?? null;
      if (id === bobId) return bobAccount;
      return null;
    };

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "post",
      path: "/player/social/friend-requests",
      cookie: account.cookie,
      body: { accountId: bobId },
    });

    assert.equal(response.status, 409);
    assert.match(response.body.message, /already friends/i);
  });

  test("returns 409 when there is already a pending request", async () => {
    const bobId = "000000000000000000000002";
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice", { sentFriendRequests: [bobId] });
    const bobAccount = createMockAccount(bobId, "Bob", {
      receivedFriendRequests: [account.player.playerId],
    });

    const GameAccount = (await import("../models/GameAccount")).default;
    (GameAccount as unknown as Record<string, unknown>).findById = (id: string) => {
      if (id === account.player.playerId) return mockAccounts.get(account.player.playerId) ?? null;
      if (id === bobId) return bobAccount;
      return null;
    };

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "post",
      path: "/player/social/friend-requests",
      cookie: account.cookie,
      body: { accountId: bobId },
    });

    assert.equal(response.status, 409);
    assert.match(response.body.message, /pending request/i);
  });

  test("returns 200 on successful friend request", async () => {
    const bobId = "000000000000000000000002";
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice");
    const bobAccount = createMockAccount(bobId, "Bob");

    const GameAccount = (await import("../models/GameAccount")).default;
    (GameAccount as unknown as Record<string, unknown>).findById = (id: string) => {
      if (id === account.player.playerId) return mockAccounts.get(account.player.playerId) ?? null;
      if (id === bobId) return bobAccount;
      return null;
    };

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "post",
      path: "/player/social/friend-requests",
      cookie: account.cookie,
      body: { accountId: bobId },
    });

    assert.equal(response.status, 200);
    assert.match(response.body.message, /friend request sent/i);
  });
});

// ─── POST /player/social/friend-requests/:accountId/accept ──────────

describe("POST /player/social/friend-requests/:accountId/accept", () => {
  test("returns 401 without session cookie", async () => {
    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "post",
      path: "/player/social/friend-requests/:accountId/accept",
      params: { accountId: "000000000000000000000001" },
    });

    assert.equal(response.status, 401);
  });

  test("returns 400 for invalid accountId format", async () => {
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice");

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "post",
      path: "/player/social/friend-requests/:accountId/accept",
      params: { accountId: "not-valid" },
      cookie: account.cookie,
    });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /invalid account id/i);
  });

  test("returns 404 when requester account does not exist", async () => {
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice");

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "post",
      path: "/player/social/friend-requests/:accountId/accept",
      params: { accountId: "000000000000000000000099" },
      cookie: account.cookie,
    });

    assert.equal(response.status, 404);
    assert.match(response.body.message, /could not be found/i);
  });

  test("returns 400 when no pending request from that player", async () => {
    const bobId = "000000000000000000000002";
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice");
    const bobAccount = createMockAccount(bobId, "Bob");

    const GameAccount = (await import("../models/GameAccount")).default;
    (GameAccount as unknown as Record<string, unknown>).findById = (id: string) => {
      if (id === account.player.playerId) return mockAccounts.get(account.player.playerId) ?? null;
      if (id === bobId) return bobAccount;
      return null;
    };

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "post",
      path: "/player/social/friend-requests/:accountId/accept",
      params: { accountId: bobId },
      cookie: account.cookie,
    });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /no pending friend request/i);
  });

  test("returns 200 when accepting a valid pending request", async () => {
    const bobId = "000000000000000000000002";
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice", {
      receivedFriendRequests: [bobId],
    });
    const bobAccount = createMockAccount(bobId, "Bob", {
      sentFriendRequests: [account.player.playerId],
    });

    const GameAccount = (await import("../models/GameAccount")).default;
    (GameAccount as unknown as Record<string, unknown>).findById = (id: string) => {
      if (id === account.player.playerId) return mockAccounts.get(account.player.playerId) ?? null;
      if (id === bobId) return bobAccount;
      return null;
    };

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "post",
      path: "/player/social/friend-requests/:accountId/accept",
      params: { accountId: bobId },
      cookie: account.cookie,
    });

    assert.equal(response.status, 200);
    assert.match(response.body.message, /accepted/i);
  });
});

// ─── POST /player/social/friend-requests/:accountId/decline ─────────

describe("POST /player/social/friend-requests/:accountId/decline", () => {
  test("returns 400 when no pending request from that player", async () => {
    const bobId = "000000000000000000000002";
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice");
    const bobAccount = createMockAccount(bobId, "Bob");

    const GameAccount = (await import("../models/GameAccount")).default;
    (GameAccount as unknown as Record<string, unknown>).findById = (id: string) => {
      if (id === account.player.playerId) return mockAccounts.get(account.player.playerId) ?? null;
      if (id === bobId) return bobAccount;
      return null;
    };

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "post",
      path: "/player/social/friend-requests/:accountId/decline",
      params: { accountId: bobId },
      cookie: account.cookie,
    });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /no pending friend request/i);
  });

  test("returns 200 when declining a valid pending request", async () => {
    const bobId = "000000000000000000000002";
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice", {
      receivedFriendRequests: [bobId],
    });
    const bobAccount = createMockAccount(bobId, "Bob", {
      sentFriendRequests: [account.player.playerId],
    });

    const GameAccount = (await import("../models/GameAccount")).default;
    (GameAccount as unknown as Record<string, unknown>).findById = (id: string) => {
      if (id === account.player.playerId) return mockAccounts.get(account.player.playerId) ?? null;
      if (id === bobId) return bobAccount;
      return null;
    };

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "post",
      path: "/player/social/friend-requests/:accountId/decline",
      params: { accountId: bobId },
      cookie: account.cookie,
    });

    assert.equal(response.status, 200);
    assert.match(response.body.message, /declined/i);
  });
});

// ─── POST /player/social/friend-requests/:accountId/cancel ──────────

describe("POST /player/social/friend-requests/:accountId/cancel", () => {
  test("returns 400 when no outgoing request to that player", async () => {
    const bobId = "000000000000000000000002";
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice");
    const bobAccount = createMockAccount(bobId, "Bob");

    const GameAccount = (await import("../models/GameAccount")).default;
    (GameAccount as unknown as Record<string, unknown>).findById = (id: string) => {
      if (id === account.player.playerId) return mockAccounts.get(account.player.playerId) ?? null;
      if (id === bobId) return bobAccount;
      return null;
    };

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "post",
      path: "/player/social/friend-requests/:accountId/cancel",
      params: { accountId: bobId },
      cookie: account.cookie,
    });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /no outgoing request/i);
  });

  test("returns 200 when cancelling a valid outgoing request", async () => {
    const bobId = "000000000000000000000002";
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice", {
      sentFriendRequests: [bobId],
    });
    const bobAccount = createMockAccount(bobId, "Bob", {
      receivedFriendRequests: [account.player.playerId],
    });

    const GameAccount = (await import("../models/GameAccount")).default;
    (GameAccount as unknown as Record<string, unknown>).findById = (id: string) => {
      if (id === account.player.playerId) return mockAccounts.get(account.player.playerId) ?? null;
      if (id === bobId) return bobAccount;
      return null;
    };

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "post",
      path: "/player/social/friend-requests/:accountId/cancel",
      params: { accountId: bobId },
      cookie: account.cookie,
    });

    assert.equal(response.status, 200);
    assert.match(response.body.message, /cancelled/i);
  });
});

// ─── POST /player/social/friends/:accountId/remove ──────────────────

describe("POST /player/social/friends/:accountId/remove", () => {
  test("returns 400 for invalid accountId format", async () => {
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice");

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "post",
      path: "/player/social/friends/:accountId/remove",
      params: { accountId: "not-valid" },
      cookie: account.cookie,
    });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /invalid account id/i);
  });

  test("returns 400 when target is not in friends list", async () => {
    const bobId = "000000000000000000000002";
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice");

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "post",
      path: "/player/social/friends/:accountId/remove",
      params: { accountId: bobId },
      cookie: account.cookie,
    });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /not in your friends list/i);
  });

  test("returns 200 when removing a friend", async () => {
    const bobId = "000000000000000000000002";
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice", { friends: [bobId] });
    const bobAccount = createMockAccount(bobId, "Bob", { friends: [account.player.playerId] });

    const GameAccount = (await import("../models/GameAccount")).default;
    (GameAccount as unknown as Record<string, unknown>).findById = (id: string) => {
      if (id === account.player.playerId) return mockAccounts.get(account.player.playerId) ?? null;
      if (id === bobId) return bobAccount;
      return null;
    };

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "post",
      path: "/player/social/friends/:accountId/remove",
      params: { accountId: bobId },
      cookie: account.cookie,
    });

    assert.equal(response.status, 200);
    assert.match(response.body.message, /friend removed/i);
  });
});

// ─── POST /player/social/game-invitations ───────────────────────────

describe("POST /player/social/game-invitations", () => {
  test("returns 400 when gameId or recipientId is missing", async () => {
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice");

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "post",
      path: "/player/social/game-invitations",
      cookie: account.cookie,
      body: {},
    });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /choose a game and friend/i);
  });

  test("returns 400 when expiresInMinutes is missing", async () => {
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice");

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "post",
      path: "/player/social/game-invitations",
      cookie: account.cookie,
      body: { gameId: "GAME1", recipientId: "000000000000000000000002" },
    });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /invitation duration/i);
  });

  test("returns 400 when expiresInMinutes is too small", async () => {
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice");

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "post",
      path: "/player/social/game-invitations",
      cookie: account.cookie,
      body: { gameId: "GAME1", recipientId: "000000000000000000000002", expiresInMinutes: 1 },
    });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /invitation duration/i);
  });

  test("returns 400 when expiresInMinutes is too large", async () => {
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice");

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "post",
      path: "/player/social/game-invitations",
      cookie: account.cookie,
      body: { gameId: "GAME1", recipientId: "000000000000000000000002", expiresInMinutes: 99999 },
    });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /invitation duration/i);
  });

  test("returns 404 when recipient does not exist", async () => {
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice");

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "post",
      path: "/player/social/game-invitations",
      cookie: account.cookie,
      body: {
        gameId: "GAME1",
        recipientId: "000000000000000000000099",
        expiresInMinutes: 60,
      },
    });

    assert.equal(response.status, 404);
    assert.match(response.body.message, /could not be found/i);
  });

  test("returns 403 when recipient is not a friend", async () => {
    const bobId = "000000000000000000000002";
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice"); // No friends
    createMockAccount(bobId, "Bob");

    const GameAccount = (await import("../models/GameAccount")).default;
    (GameAccount as unknown as Record<string, unknown>).findById = (id: string) => {
      if (id === account.player.playerId) return mockAccounts.get(account.player.playerId) ?? null;
      if (id === bobId) return mockAccounts.get(bobId) ?? null;
      return null;
    };

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "post",
      path: "/player/social/game-invitations",
      cookie: account.cookie,
      body: { gameId: "GAME1", recipientId: bobId, expiresInMinutes: 60 },
    });

    assert.equal(response.status, 403);
    assert.match(response.body.message, /friends list/i);
  });

  test("returns 403 when sender is not in the game room", async () => {
    const bobId = "000000000000000000000002";
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice", { friends: [bobId] });
    createMockAccount(bobId, "Bob");

    const GameAccount = (await import("../models/GameAccount")).default;
    (GameAccount as unknown as Record<string, unknown>).findById = (id: string) => {
      if (id === account.player.playerId) return mockAccounts.get(account.player.playerId) ?? null;
      if (id === bobId) return mockAccounts.get(bobId) ?? null;
      return null;
    };

    // gameService.getSnapshot returns a room with no players (default mock)
    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "post",
      path: "/player/social/game-invitations",
      cookie: account.cookie,
      body: { gameId: "GAME1", recipientId: bobId, expiresInMinutes: 60 },
    });

    assert.equal(response.status, 403);
    assert.match(response.body.message, /join the room/i);
  });

  test("returns 201 when invitation is successfully created", async () => {
    const bobId = "000000000000000000000002";
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice", { friends: [bobId] });
    createMockAccount(bobId, "Bob");

    const GameAccount = (await import("../models/GameAccount")).default;
    (GameAccount as unknown as Record<string, unknown>).findById = (id: string) => {
      if (id === account.player.playerId) return mockAccounts.get(account.player.playerId) ?? null;
      if (id === bobId) return mockAccounts.get(bobId) ?? null;
      return null;
    };

    // Mock gameService to return a snapshot where Alice is in the room
    const gameServiceModule = (await import("../game/gameService")) as Record<string, unknown>;
    const aliceId = account.player.playerId;
    (gameServiceModule.gameService as Record<string, unknown>).getSnapshot = async () => ({
      gameId: "GAME1",
      roomType: "direct",
      status: "waiting",
      players: [{ player: { playerId: aliceId } }],
    });

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "post",
      path: "/player/social/game-invitations",
      cookie: account.cookie,
      body: { gameId: "GAME1", recipientId: bobId, expiresInMinutes: 60 },
    });

    assert.equal(response.status, 201);
    assert.match(response.body.message, /invitation sent/i);
  });
});

// ─── POST /player/social/game-invitations/:invitationId/revoke ──────

describe("POST /player/social/game-invitations/:invitationId/revoke", () => {
  test("returns 400 for invalid invitation ID", async () => {
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice");

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "post",
      path: "/player/social/game-invitations/:invitationId/revoke",
      params: { invitationId: "not-valid" },
      cookie: account.cookie,
    });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /invalid invitation id/i);
  });

  test("returns 404 when invitation does not exist", async () => {
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice");

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "post",
      path: "/player/social/game-invitations/:invitationId/revoke",
      params: { invitationId: "000000000000000000000099" },
      cookie: account.cookie,
    });

    assert.equal(response.status, 404);
    assert.match(response.body.message, /no longer active/i);
  });

  test("returns 200 when revoking own invitation", async () => {
    const invId = "000000000000000000000010";
    const bobId = "000000000000000000000002";
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice");

    createMockInvitation(invId, {
      gameId: "GAME1",
      senderId: account.player.playerId,
      recipientId: bobId,
      status: "pending",
    });

    const GameInvitation = (await import("../models/GameInvitation")).default;
    (GameInvitation as unknown as Record<string, unknown>).findOne = (
      filter: Record<string, unknown>,
    ) => {
      const idStr = filter._id?.toString?.() ?? String(filter._id);
      const inv = mockInvitations.get(idStr);
      if (!inv) return null;
      // Check senderId matches
      if (filter.senderId) {
        const invSender = (inv.senderId as { toString(): string }).toString();
        const filterSender = filter.senderId.toString?.() ?? String(filter.senderId);
        if (invSender !== filterSender) return null;
      }
      if ((inv as Record<string, unknown>).status !== filter.status) return null;
      return inv;
    };

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "post",
      path: "/player/social/game-invitations/:invitationId/revoke",
      params: { invitationId: invId },
      cookie: account.cookie,
    });

    assert.equal(response.status, 200);
    assert.match(response.body.message, /revoked/i);
  });
});

// ─── POST /player/social/game-invitations/:invitationId/decline ─────

describe("POST /player/social/game-invitations/:invitationId/decline", () => {
  test("returns 400 for invalid invitation ID", async () => {
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice");

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "post",
      path: "/player/social/game-invitations/:invitationId/decline",
      params: { invitationId: "not-valid" },
      cookie: account.cookie,
    });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /invalid invitation id/i);
  });

  test("returns 404 when invitation does not exist", async () => {
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice");

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "post",
      path: "/player/social/game-invitations/:invitationId/decline",
      params: { invitationId: "000000000000000000000099" },
      cookie: account.cookie,
    });

    assert.equal(response.status, 404);
    assert.match(response.body.message, /no longer active/i);
  });

  test("returns 200 when declining an invitation addressed to you", async () => {
    const invId = "000000000000000000000010";
    const bobId = "000000000000000000000002";
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice");

    createMockInvitation(invId, {
      gameId: "GAME1",
      senderId: bobId,
      recipientId: account.player.playerId,
      status: "pending",
    });

    const GameInvitation = (await import("../models/GameInvitation")).default;
    (GameInvitation as unknown as Record<string, unknown>).findOne = (
      filter: Record<string, unknown>,
    ) => {
      const idStr = filter._id?.toString?.() ?? String(filter._id);
      const inv = mockInvitations.get(idStr);
      if (!inv) return null;
      if (filter.recipientId) {
        const invRecipient = (inv.recipientId as { toString(): string }).toString();
        const filterRecipient = filter.recipientId.toString?.() ?? String(filter.recipientId);
        if (invRecipient !== filterRecipient) return null;
      }
      if ((inv as Record<string, unknown>).status !== filter.status) return null;
      return inv;
    };

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "post",
      path: "/player/social/game-invitations/:invitationId/decline",
      params: { invitationId: invId },
      cookie: account.cookie,
    });

    assert.equal(response.status, 200);
    assert.match(response.body.message, /declined/i);
  });
});

// ─── GET /player/social/friends/:friendId/active-games ──────────────

describe("GET /player/social/friends/:friendId/active-games", () => {
  test("returns 401 without session cookie", async () => {
    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "get",
      path: "/player/social/friends/:friendId/active-games",
      params: { friendId: "000000000000000000000001" },
    });

    assert.equal(response.status, 401);
  });

  test("returns 400 for invalid friendId", async () => {
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice");

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "get",
      path: "/player/social/friends/:friendId/active-games",
      params: { friendId: "not-valid" },
      cookie: account.cookie,
    });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /invalid account id/i);
  });

  test("returns 403 when target is not a friend", async () => {
    const bobId = "000000000000000000000002";
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice");

    const response = await invokeRoute<{ message: string }>(socialRoutes, {
      method: "get",
      path: "/player/social/friends/:friendId/active-games",
      params: { friendId: bobId },
      cookie: account.cookie,
    });

    assert.equal(response.status, 403);
    assert.match(response.body.message, /only view active games of your friends/i);
  });

  test("returns 200 with games for a valid friend", async () => {
    const bobId = "000000000000000000000002";
    const account = createTestAccount("Alice", "alice@example.com");
    createMockAccount(account.player.playerId, "Alice", { friends: [bobId] });

    const response = await invokeRoute<{ games: unknown[] }>(socialRoutes, {
      method: "get",
      path: "/player/social/friends/:friendId/active-games",
      params: { friendId: bobId },
      cookie: account.cookie,
    });

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body.games));
  });
});
