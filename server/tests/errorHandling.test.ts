import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { AuthResponse } from "../../shared/src";
import { classifyMongoError } from "../error-handling";
import { createTestGuest, resetTestSessions, installTestSessionMock } from "./testAuthHelper";

process.env.TOKEN_SECRET ??= "test-token-secret";
process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/tiao-test";
process.env.S3_BUCKET_NAME ??= "tiao-test-assets";
process.env.S3_PUBLIC_URL ??= "https://assets.test.local";

type PatchedGameService = {
  createGame: unknown;
  joinGame: unknown;
  accessGame: unknown;
  getSnapshot: unknown;
  listGames: unknown;
  enterMatchmaking: unknown;
  getMatchmakingState: unknown;
  leaveMatchmaking: unknown;
};

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

let singletonGameService: (PatchedGameService & Record<string, unknown>) | null = null;
let originalMethods: Partial<PatchedGameService> = {};
let gameAuthRoutes: TestRouter;
let gameRoutes: TestRouter;

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
            if (!settled) {
              resolve();
            }
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
    headers: options.cookie
      ? {
          cookie: options.cookie,
        }
      : {},
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

function getSessionCookie<T>(response: RouteResult<T>): string {
  const setCookieHeader = response.headers["set-cookie"];
  const rawHeader = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;

  assert.equal(typeof rawHeader, "string");
  return rawHeader.split(";")[0]!;
}

function createGuest(displayName: string) {
  const { player, cookie } = createTestGuest(displayName);
  return { player, cookie };
}

beforeEach(async () => {
  resetTestSessions();
  await installTestSessionMock();

  const [
    { GameService, gameService },
    { InMemoryGameRoomStore },
    gameAuthRoutesModule,
    gameRoutesModule,
  ] = await Promise.all([
    import("../game/gameService"),
    import("../game/gameStore"),
    import("../routes/game-auth.routes"),
    import("../routes/game.routes"),
  ]);

  const service = new GameService(new InMemoryGameRoomStore(), () => 0);
  singletonGameService = gameService as unknown as PatchedGameService & Record<string, unknown>;

  originalMethods = {
    createGame: singletonGameService.createGame,
    joinGame: singletonGameService.joinGame,
    accessGame: singletonGameService.accessGame,
    getSnapshot: singletonGameService.getSnapshot,
    listGames: singletonGameService.listGames,
    enterMatchmaking: singletonGameService.enterMatchmaking,
    getMatchmakingState: singletonGameService.getMatchmakingState,
    leaveMatchmaking: singletonGameService.leaveMatchmaking,
  };

  singletonGameService.createGame = service.createGame.bind(service);
  singletonGameService.joinGame = service.joinGame.bind(service);
  singletonGameService.accessGame = service.accessGame.bind(service);
  singletonGameService.getSnapshot = service.getSnapshot.bind(service);
  singletonGameService.listGames = service.listGames.bind(service);
  singletonGameService.enterMatchmaking = service.enterMatchmaking.bind(service);
  singletonGameService.getMatchmakingState = service.getMatchmakingState.bind(service);
  singletonGameService.leaveMatchmaking = service.leaveMatchmaking.bind(service);

  gameAuthRoutes = gameAuthRoutesModule.default as TestRouter;
  gameRoutes = gameRoutesModule.default as TestRouter;
});

afterEach(() => {
  if (singletonGameService) {
    Object.assign(singletonGameService, originalMethods);
  }
});

// ── Unit tests for classifyMongoError ──────────────────────────────────

describe("classifyMongoError", () => {
  test("returns null for non-Mongo errors", () => {
    assert.equal(classifyMongoError(new Error("generic")), null);
    assert.equal(classifyMongoError(null), null);
    assert.equal(classifyMongoError("string error"), null);
    assert.equal(classifyMongoError(undefined), null);
  });

  test("classifies E11000 duplicate key error with field name", () => {
    const error = Object.assign(new Error("E11000 duplicate key"), {
      name: "MongoServerError",
      code: 11000,
      keyPattern: { email: 1 },
      keyValue: { email: "test@example.com" },
    });

    const result = classifyMongoError(error);
    assert.ok(result);
    assert.equal(result.status, 409);
    assert.equal(result.code, "DUPLICATE_KEY");
    assert.match(result.message, /email/);
  });

  test("classifies E11000 with displayName field", () => {
    const error = Object.assign(new Error("E11000 duplicate key"), {
      name: "MongoServerError",
      code: 11000,
      keyPattern: { displayName: 1 },
      keyValue: { displayName: "Alice" },
    });

    const result = classifyMongoError(error);
    assert.ok(result);
    assert.equal(result.status, 409);
    assert.match(result.message, /displayName/);
  });

  test("classifies E11000 without keyPattern", () => {
    const error = Object.assign(new Error("E11000 duplicate key"), {
      name: "MongoServerError",
      code: 11000,
    });

    const result = classifyMongoError(error);
    assert.ok(result);
    assert.equal(result.status, 409);
    assert.equal(result.code, "DUPLICATE_KEY");
  });

  test("returns null for non-duplicate-key MongoServerError", () => {
    const error = Object.assign(new Error("some other mongo error"), {
      name: "MongoServerError",
      code: 999,
    });

    assert.equal(classifyMongoError(error), null);
  });
});

// ── Integration tests: routes recover from thrown errors ───────────────

// Auth route error handling tests removed — session management is now handled
// by better-auth. The old POST /guest route and commitPlayerSession/refreshPlayerSession
// functions no longer exist. Error handling for better-auth's session layer is
// tested by better-auth itself.

describe("game route error handling", () => {
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  beforeEach(() => {
    console.error = () => {};
    console.warn = () => {};
  });
  afterEach(() => {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
  });

  test("POST /games recovers from game service failure", async () => {
    const guest = await createGuest("GameErrorGuest");

    singletonGameService!.createGame = () => {
      throw new Error("unexpected internal error");
    };

    const response = await invokeRoute<{ code: string; message: string }>(gameRoutes, {
      method: "post",
      path: "/games",
      cookie: guest.cookie,
    });

    assert.equal(response.status, 500);
    assert.ok(response.body.message);
  });

  test("GET /games recovers from game service failure", async () => {
    const guest = await createGuest("ListErrorGuest");

    singletonGameService!.listGames = () => {
      throw new Error("list failure");
    };

    const response = await invokeRoute<{ message: string }>(gameRoutes, {
      method: "get",
      path: "/games",
      cookie: guest.cookie,
    });

    assert.equal(response.status, 500);
    assert.ok(response.body.message);
  });

  test("POST /matchmaking recovers from service error", async () => {
    const guest = await createGuest("MatchErrorGuest");

    singletonGameService!.enterMatchmaking = () => {
      throw new Error("matchmaking broken");
    };

    const response = await invokeRoute<{ message: string }>(gameRoutes, {
      method: "post",
      path: "/matchmaking",
      cookie: guest.cookie,
    });

    assert.equal(response.status, 500);
    assert.ok(response.body.message);
  });
});

describe("MongoDB duplicate key error surfaces as 409", () => {
  const originalConsoleWarn = console.warn;
  beforeEach(() => {
    console.warn = () => {};
  });
  afterEach(() => {
    console.warn = originalConsoleWarn;
  });

  // Signup duplicate key test removed — signup is now handled by better-auth.
  // Duplicate key errors during account creation are caught by better-auth's
  // databaseHooks and the MongoDB adapter.
});
