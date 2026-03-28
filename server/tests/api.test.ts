import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createTestGuest, resetTestSessions, installTestSessionMock } from "./testAuthHelper";
import type { AuthResponse, MatchmakingState, MultiplayerSnapshot } from "../../shared/src";

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

type SessionAuth = AuthResponse & {
  cookie: string;
};

let singletonGameService: (PatchedGameService & Record<string, unknown>) | null = null;
let originalMethods: Partial<PatchedGameService> = {};
let indexRoutes: TestRouter;
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

function createGuest(displayName: string): SessionAuth {
  const { player, cookie } = createTestGuest(displayName);
  return { player, cookie };
}

beforeEach(async () => {
  resetTestSessions();
  await installTestSessionMock();

  const [
    { GameService, gameService },
    { InMemoryGameRoomStore },
    indexRoutesModule,
    gameAuthRoutesModule,
    gameRoutesModule,
  ] = await Promise.all([
    import("../game/gameService"),
    import("../game/gameStore"),
    import("../routes/index.routes"),
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

  indexRoutes = indexRoutesModule.default as TestRouter;
  gameAuthRoutes = gameAuthRoutesModule.default as TestRouter;
  gameRoutes = gameRoutesModule.default as TestRouter;
});

afterEach(() => {
  if (singletonGameService) {
    Object.assign(singletonGameService, originalMethods);
  }
});

test("health endpoint reports readiness shape", async () => {
  const response = await invokeRoute<{
    status: string;
    database: string;
  }>(indexRoutes, {
    method: "get",
    path: "/health",
  });

  assert.ok([200, 503].includes(response.status));
  assert.ok(["ok", "starting"].includes(response.body.status));
  assert.ok(["connected", "disconnected"].includes(response.body.database));
});

test("guest auth issues a session cookie and /me reflects the current player", async () => {
  const auth = await createGuest("API Guest");

  assert.equal(auth.player.displayName, "API Guest");
  assert.equal(auth.player.kind, "guest");
  assert.match(auth.cookie, /^tiao\.session=/);

  const response = await invokeRoute<{
    player: AuthResponse["player"];
  }>(gameAuthRoutes, {
    method: "get",
    path: "/me",
    cookie: auth.cookie,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.player.playerId, auth.player.playerId);
  assert.equal(response.body.player.displayName, auth.player.displayName);
});

test("logout clears the current session", async () => {
  const auth = await createGuest("Logout Guest");

  const logout = await invokeRoute<undefined>(gameAuthRoutes, {
    method: "post",
    path: "/logout",
    cookie: auth.cookie,
  });

  assert.equal(logout.status, 204);

  const me = await invokeRoute<{ message: string }>(gameAuthRoutes, {
    method: "get",
    path: "/me",
    cookie: auth.cookie,
  });

  assert.equal(me.status, 401);
  assert.match(me.body.message, /not authenticated/i);
});

test("multiplayer routes create games, join open seats, and allow spectators", async () => {
  const host = await createGuest("Host");
  const challenger = await createGuest("Challenger");
  const spectator = await createGuest("Spectator");

  const created = await invokeRoute<{ snapshot: MultiplayerSnapshot }>(gameRoutes, {
    method: "post",
    path: "/games",
    cookie: host.cookie,
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.snapshot.status, "waiting");
  assert.equal(created.body.snapshot.players.length, 1);

  const joined = await invokeRoute<{ snapshot: MultiplayerSnapshot }>(gameRoutes, {
    method: "post",
    path: "/games/:gameId/join",
    params: {
      gameId: created.body.snapshot.gameId,
    },
    cookie: challenger.cookie,
  });
  assert.equal(joined.status, 200);
  assert.equal(joined.body.snapshot.status, "active");
  assert.equal(joined.body.snapshot.players.length, 2);

  const spectated = await invokeRoute<{ snapshot: MultiplayerSnapshot }>(gameRoutes, {
    method: "post",
    path: "/games/:gameId/access",
    params: {
      gameId: created.body.snapshot.gameId,
    },
    cookie: spectator.cookie,
  });
  assert.equal(spectated.status, 200);
  assert.equal(spectated.body.snapshot.players.length, 2);
  assert.equal(
    spectated.body.snapshot.players.some(
      (slot) => slot.player.playerId === spectator.player.playerId,
    ),
    false,
  );

  const loaded = await invokeRoute<{ snapshot: MultiplayerSnapshot }>(gameRoutes, {
    method: "get",
    path: "/games/:gameId",
    params: {
      gameId: created.body.snapshot.gameId,
    },
    cookie: host.cookie,
  });
  assert.equal(loaded.status, 200);
  assert.equal(loaded.body.snapshot.gameId, created.body.snapshot.gameId);

  // Snapshot includes an empty spectators array
  assert.ok(Array.isArray(spectated.body.snapshot.spectators));
  assert.equal(spectated.body.snapshot.spectators.length, 0);
});

test("matchmaking API pairs the next two players into a matchmaking room", async () => {
  const alice = await createGuest("Alice");
  const bob = await createGuest("Bob");

  const first = await invokeRoute<{ matchmaking: MatchmakingState }>(gameRoutes, {
    method: "post",
    path: "/matchmaking",
    cookie: alice.cookie,
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.matchmaking.status, "searching");

  const second = await invokeRoute<{ matchmaking: MatchmakingState }>(gameRoutes, {
    method: "post",
    path: "/matchmaking",
    cookie: bob.cookie,
  });
  assert.equal(second.status, 200);
  assert.equal(second.body.matchmaking.status, "matched");
  if (second.body.matchmaking.status !== "matched") {
    return;
  }

  assert.equal(second.body.matchmaking.snapshot.roomType, "matchmaking");
  assert.equal(second.body.matchmaking.snapshot.status, "active");

  const aliceState = await invokeRoute<{ matchmaking: MatchmakingState }>(gameRoutes, {
    method: "get",
    path: "/matchmaking",
    cookie: alice.cookie,
  });
  assert.equal(aliceState.status, 200);
  assert.equal(aliceState.body.matchmaking.status, "matched");
  if (aliceState.body.matchmaking.status !== "matched") {
    return;
  }

  assert.equal(
    aliceState.body.matchmaking.snapshot.gameId,
    second.body.matchmaking.snapshot.gameId,
  );

  const left = await invokeRoute<undefined>(gameRoutes, {
    method: "delete",
    path: "/matchmaking",
    cookie: alice.cookie,
  });
  assert.equal(left.status, 204);

  const cleared = await invokeRoute<{ matchmaking: MatchmakingState }>(gameRoutes, {
    method: "get",
    path: "/matchmaking",
    cookie: alice.cookie,
  });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.matchmaking.status, "idle");
});

test("multiplayer routes reject unauthenticated callers", async () => {
  const response = await invokeRoute<{ message: string }>(gameRoutes, {
    method: "get",
    path: "/games",
  });

  assert.equal(response.status, 401);
  assert.match(
    response.body.message,
    /authenticate as a guest or account before using multiplayer/i,
  );
});
