import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import type { AuthResponse, MultiplayerSnapshot, PublicGameReplay } from "../../shared/src";
import {
  createTestGuest,
  installTestSessionMock,
  removeTestSession,
  resetTestSessions,
} from "./testAuthHelper";

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
  testForceFinishGame: unknown;
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

function _getSessionCookie<T>(response: RouteResult<T>): string {
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

  // Prevent achievement checks from hitting Mongoose (no DB in unit tests)
  const achievementMod = (await import("../game/achievementService")) as Record<string, unknown>;
  achievementMod.onGameCompleted = async () => {};
  achievementMod.onEloUpdated = async () => {};
  achievementMod.onSpectateStarted = async () => {};
  achievementMod.onTournamentWon = async () => {};

  // Mock GameRoom to prevent Mongoose buffering timeouts
  const GameRoom = (await import("../models/GameRoom")).default;
  (GameRoom as unknown as Record<string, unknown>).findOne = () => ({
    select: () => ({ lean: () => null }),
    lean: () => null,
  });
  (GameRoom as unknown as Record<string, unknown>).countDocuments = async () => 0;

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
    testForceFinishGame: singletonGameService.testForceFinishGame,
  };

  singletonGameService.createGame = service.createGame.bind(service);
  singletonGameService.joinGame = service.joinGame.bind(service);
  singletonGameService.accessGame = service.accessGame.bind(service);
  singletonGameService.getSnapshot = service.getSnapshot.bind(service);
  singletonGameService.listGames = service.listGames.bind(service);
  singletonGameService.enterMatchmaking = service.enterMatchmaking.bind(service);
  singletonGameService.getMatchmakingState = service.getMatchmakingState.bind(service);
  singletonGameService.leaveMatchmaking = service.leaveMatchmaking.bind(service);
  singletonGameService.testForceFinishGame = service.testForceFinishGame.bind(service);

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
  assert.match(auth.cookie, /^tiao\./);

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

  // Simulate session invalidation (in production better-auth handles this server-side)
  removeTestSession(auth.cookie);

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

// Matchmaking now lives on the lobby WebSocket. Service-layer behavior is
// covered by matchmakingEdgeCases.test.ts; the REST route this test exercised
// was removed to eliminate ghost queue entries.

test("guests can join and access direct/custom games (previous gate removed)", async () => {
  // Before this fix, guests hitting a direct room got 403
  // GUEST_CANNOT_JOIN_CUSTOM_GAME. The gate looked the room up via
  // GameRoom.findOne({ roomId }).select("roomType"); we force that lookup to
  // return a direct room so that, if the gate were still in place, the
  // handlers would return 403. A passing test here means guests flow
  // straight through to the service.
  const GameRoom = (await import("../models/GameRoom")).default;
  const directRoomLookup = {
    select: () => ({ lean: async () => ({ roomType: "direct" }) }),
    lean: async () => ({ roomType: "direct" }),
  };
  (GameRoom as unknown as Record<string, unknown>).findOne = () => directRoomLookup;

  const host = await createGuest("HostForDirect");
  const joiner = await createGuest("JoinerAsGuest");
  const watcher = await createGuest("GuestSpectator");

  const created = await invokeRoute<{ snapshot: MultiplayerSnapshot }>(gameRoutes, {
    method: "post",
    path: "/games",
    cookie: host.cookie,
  });
  assert.equal(created.status, 201);
  const gameId = created.body.snapshot.gameId;

  const joined = await invokeRoute<{ snapshot: MultiplayerSnapshot; code?: string }>(gameRoutes, {
    method: "post",
    path: "/games/:gameId/join",
    params: { gameId },
    cookie: joiner.cookie,
  });
  assert.equal(
    joined.status,
    200,
    `Expected guest to join direct room, got ${joined.status} (${JSON.stringify(joined.body)})`,
  );
  assert.notEqual(joined.body.code, "GUEST_CANNOT_JOIN_CUSTOM_GAME");

  const accessed = await invokeRoute<{ snapshot: MultiplayerSnapshot; code?: string }>(gameRoutes, {
    method: "post",
    path: "/games/:gameId/access",
    params: { gameId },
    cookie: watcher.cookie,
  });
  assert.equal(
    accessed.status,
    200,
    `Expected guest to access direct room, got ${accessed.status} (${JSON.stringify(accessed.body)})`,
  );
  assert.notEqual(accessed.body.code, "GUEST_CANNOT_JOIN_CUSTOM_GAME");
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

test("public replay endpoint serves finished games without auth and hides live ones", async () => {
  const host = await createGuest("Host");
  const challenger = await createGuest("Challenger");

  const created = await invokeRoute<{ snapshot: MultiplayerSnapshot }>(gameRoutes, {
    method: "post",
    path: "/games",
    cookie: host.cookie,
  });
  assert.equal(created.status, 201);
  const gameId = created.body.snapshot.gameId;

  // Waiting game: not replayable (and must not leak the position).
  const waiting = await invokeRoute<{ code: string }>(gameRoutes, {
    method: "get",
    path: "/games/:gameId/replay",
    params: { gameId },
  });
  assert.equal(waiting.status, 404);
  assert.equal(waiting.body.code, "GAME_NOT_FINISHED");

  const joined = await invokeRoute<{ snapshot: MultiplayerSnapshot }>(gameRoutes, {
    method: "post",
    path: "/games/:gameId/join",
    params: { gameId },
    cookie: challenger.cookie,
  });
  assert.equal(joined.status, 200);

  // Active game: still hidden.
  const active = await invokeRoute<{ code: string }>(gameRoutes, {
    method: "get",
    path: "/games/:gameId/replay",
    params: { gameId },
  });
  assert.equal(active.status, 404);

  const finish = await invokeRoute<{ message: string }>(gameRoutes, {
    method: "post",
    path: "/games/:gameId/test-finish",
    params: { gameId },
    body: { winner: "white" },
  });
  assert.equal(finish.status, 200);

  // Finished game: public, no cookie needed.
  const replayed = await invokeRoute<{ replay: PublicGameReplay }>(gameRoutes, {
    method: "get",
    path: "/games/:gameId/replay",
    params: { gameId },
  });
  assert.equal(replayed.status, 200);
  const replay = replayed.body.replay;
  assert.equal(replay.gameId, gameId);
  assert.equal(replay.status, "finished");
  assert.equal(replay.winner, "white");
  assert.equal(replay.white?.displayName, "Host");
  assert.equal(replay.black?.displayName, "Challenger");
  assert.ok(Array.isArray(replay.history));
  assert.equal(typeof replay.boardSize, "number");
  // No player ids / emails leak through the public payload.
  assert.equal("playerId" in (replay.white as object), false);

  const invalid = await invokeRoute<{ code: string }>(gameRoutes, {
    method: "get",
    path: "/games/:gameId/replay",
    params: { gameId: "nope!" },
  });
  assert.equal(invalid.status, 400);
});
