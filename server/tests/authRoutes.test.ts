import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import type { PlayerIdentity } from "../../shared/src";
import {
  createTestGuest,
  createTestAccount,
  resetTestSessions,
  installTestSessionMock,
} from "./testAuthHelper";

process.env.TOKEN_SECRET ??= "test-token-secret";
process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/tiao-test";
process.env.S3_BUCKET_NAME ??= "tiao-test-assets";
process.env.S3_PUBLIC_URL ??= "https://assets.test.local";

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
    method: "get" | "post" | "delete" | "put";
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

let gameAuthRoutes: TestRouter;

beforeEach(async () => {
  resetTestSessions();
  await installTestSessionMock();

  const gameAuthRoutesModule = await import("../routes/game-auth.routes");
  gameAuthRoutes = gameAuthRoutesModule.default as TestRouter;
});

afterEach(() => {
  resetTestSessions();
});

// ─── /me route tests ───────────────────────────────────────────────

test("/me returns 401 without session cookie", async () => {
  const response = await invokeRoute<{ message: string }>(gameAuthRoutes, {
    method: "get",
    path: "/me",
  });

  assert.equal(response.status, 401);
  assert.match(response.body.message, /not authenticated/i);
});

test("/me returns the current guest player with a valid session", async () => {
  const guest = createTestGuest("Session Guest");

  const response = await invokeRoute<{ player: PlayerIdentity }>(gameAuthRoutes, {
    method: "get",
    path: "/me",
    cookie: guest.cookie,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.player.playerId, guest.player.playerId);
  assert.equal(response.body.player.displayName, "Session Guest");
  assert.equal(response.body.player.kind, "guest");
});

test("/me returns account player identity", async () => {
  const account = createTestAccount("test-user", "test@example.com");

  const response = await invokeRoute<{ player: PlayerIdentity }>(gameAuthRoutes, {
    method: "get",
    path: "/me",
    cookie: account.cookie,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.player.playerId, account.player.playerId);
  assert.equal(response.body.player.kind, "account");
});

// ─── Custom login wrapper tests ─────────────────────────────────────

test("login returns 400 for missing identifier", async () => {
  const response = await invokeRoute<{ code: string }>(gameAuthRoutes, {
    method: "post",
    path: "/login",
    body: { password: "test123456" },
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.code, "VALIDATION_ERROR");
});

test("login returns 400 for missing password", async () => {
  const response = await invokeRoute<{ code: string }>(gameAuthRoutes, {
    method: "post",
    path: "/login",
    body: { identifier: "alice" },
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.code, "VALIDATION_ERROR");
});

// ─── Route existence checks ─────────────────────────────────────────

test("PUT /profile route exists", async () => {
  const layer = gameAuthRoutes.stack.find(
    (entry) => entry.route?.path === "/profile" && entry.route.methods["put"],
  );
  assert.ok(layer?.route, "PUT /profile route should exist");
});

test("GET /profile route exists", async () => {
  const layer = gameAuthRoutes.stack.find(
    (entry) => entry.route?.path === "/profile" && entry.route.methods["get"],
  );
  assert.ok(layer?.route, "GET /profile route should exist");
});

test("PUT /badges/active route exists", async () => {
  const layer = gameAuthRoutes.stack.find(
    (entry) => entry.route?.path === "/badges/active" && entry.route.methods["put"],
  );
  assert.ok(layer?.route, "PUT /badges/active route should exist");
});

test("POST /tutorial-complete route exists", async () => {
  const layer = gameAuthRoutes.stack.find(
    (entry) => entry.route?.path === "/tutorial-complete" && entry.route.methods["post"],
  );
  assert.ok(layer?.route, "POST /tutorial-complete route should exist");
});

test("POST /login route exists", async () => {
  const layer = gameAuthRoutes.stack.find(
    (entry) => entry.route?.path === "/login" && entry.route.methods["post"],
  );
  assert.ok(layer?.route, "POST /login route should exist");
});

test("GET /me route exists", async () => {
  const layer = gameAuthRoutes.stack.find(
    (entry) => entry.route?.path === "/me" && entry.route.methods["get"],
  );
  assert.ok(layer?.route, "GET /me route should exist");
});

// ─── Removed routes should NOT exist ─────────────────────────────────

test("POST /guest route no longer exists (handled by better-auth)", async () => {
  const layer = gameAuthRoutes.stack.find(
    (entry) => entry.route?.path === "/guest" && entry.route.methods["post"],
  );
  assert.equal(layer, undefined, "POST /guest should not exist");
});

test("POST /signup route no longer exists (handled by better-auth)", async () => {
  const layer = gameAuthRoutes.stack.find(
    (entry) => entry.route?.path === "/signup" && entry.route.methods["post"],
  );
  assert.equal(layer, undefined, "POST /signup should not exist");
});

test("POST /logout route no longer exists (handled by better-auth)", async () => {
  const layer = gameAuthRoutes.stack.find(
    (entry) => entry.route?.path === "/logout" && entry.route.methods["post"],
  );
  assert.equal(layer, undefined, "POST /logout should not exist");
});

// ─── Admin badge endpoints ──────────────────────────────────────────

test("POST /admin/badges/grant route exists", async () => {
  const layer = gameAuthRoutes.stack.find(
    (entry) => entry.route?.path === "/admin/badges/grant" && entry.route.methods["post"],
  );
  assert.ok(layer?.route, "POST /admin/badges/grant route should exist");
});

test("POST /admin/badges/revoke route exists", async () => {
  const layer = gameAuthRoutes.stack.find(
    (entry) => entry.route?.path === "/admin/badges/revoke" && entry.route.methods["post"],
  );
  assert.ok(layer?.route, "POST /admin/badges/revoke route should exist");
});

test("POST /admin/badges/grant returns 401 without session", async () => {
  const response = await invokeRoute<{ code: string }>(gameAuthRoutes, {
    method: "post",
    path: "/admin/badges/grant",
    body: { playerId: "some-id", badgeId: "creator" },
  });

  assert.equal(response.status, 401);
  assert.equal(response.body.code, "NOT_AUTHENTICATED");
});

test("POST /admin/badges/grant returns 403 for non-admin account", async () => {
  const account = createTestAccount("regular-user");

  const response = await invokeRoute<{ code: string }>(gameAuthRoutes, {
    method: "post",
    path: "/admin/badges/grant",
    cookie: account.cookie,
    body: { playerId: "some-id", badgeId: "creator" },
  });

  assert.equal(response.status, 403);
  assert.equal(response.body.code, "ADMIN_REQUIRED");
});

test("POST /admin/badges/grant returns 400 for missing fields", async () => {
  const admin = createTestAccount("admin-user", "admin@test.com", { isAdmin: true });

  const response = await invokeRoute<{ code: string }>(gameAuthRoutes, {
    method: "post",
    path: "/admin/badges/grant",
    cookie: admin.cookie,
    body: {},
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.code, "VALIDATION_ERROR");
});

test("POST /admin/badges/revoke returns 403 for non-admin account", async () => {
  const account = createTestAccount("regular-user-2");

  const response = await invokeRoute<{ code: string }>(gameAuthRoutes, {
    method: "post",
    path: "/admin/badges/revoke",
    cookie: account.cookie,
    body: { playerId: "some-id", badgeId: "creator" },
  });

  assert.equal(response.status, 403);
  assert.equal(response.body.code, "ADMIN_REQUIRED");
});
