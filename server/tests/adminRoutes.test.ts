import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
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

let adminRoutes: TestRouter;
let adminPlayerId: string;
let adminCookie: string;

beforeEach(async () => {
  resetTestSessions();
  await installTestSessionMock();

  // Create an admin account and set env var
  const admin = createTestAccount("admin-user", "admin@example.com");
  adminPlayerId = admin.player.playerId;
  adminCookie = admin.cookie;
  process.env.ADMIN_PLAYER_IDS = adminPlayerId;

  const adminRoutesModule = await import("../routes/admin.routes");
  adminRoutes = adminRoutesModule.default as TestRouter;
});

afterEach(() => {
  resetTestSessions();
  delete process.env.ADMIN_PLAYER_IDS;
});

// ─── User search tests ──────────────────────────────────────────────

describe("GET /users/search", () => {
  test("returns 401 without session cookie", async () => {
    const response = await invokeRoute<{ message: string }>(adminRoutes, {
      method: "get",
      path: "/users/search",
      query: { q: "test" },
    });

    assert.equal(response.status, 401);
  });

  test("returns 403 for non-admin account", async () => {
    const regularUser = createTestAccount("regular-user", "regular@example.com");

    const response = await invokeRoute<{ message: string }>(adminRoutes, {
      method: "get",
      path: "/users/search",
      query: { q: "test" },
      cookie: regularUser.cookie,
    });

    assert.equal(response.status, 403);
    assert.match(response.body.message, /admin/i);
  });

  test("returns 403 for guest user", async () => {
    const guest = createTestGuest("Guest User");

    const response = await invokeRoute<{ message: string }>(adminRoutes, {
      method: "get",
      path: "/users/search",
      query: { q: "test" },
      cookie: guest.cookie,
    });

    assert.equal(response.status, 403);
  });

  test("returns 400 for empty query", async () => {
    const response = await invokeRoute<{ message: string }>(adminRoutes, {
      method: "get",
      path: "/users/search",
      query: { q: "" },
      cookie: adminCookie,
    });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /required/i);
  });

  test("returns 400 for missing query parameter", async () => {
    const response = await invokeRoute<{ message: string }>(adminRoutes, {
      method: "get",
      path: "/users/search",
      query: {},
      cookie: adminCookie,
    });

    assert.equal(response.status, 400);
  });
});

// ─── Badge grant tests ──────────────────────────────────────────────

describe("POST /badges/grant", () => {
  test("returns 401 without session cookie", async () => {
    const response = await invokeRoute<{ message: string }>(adminRoutes, {
      method: "post",
      path: "/badges/grant",
      body: { playerId: "some-id", badgeId: "supporter" },
    });

    assert.equal(response.status, 401);
  });

  test("returns 403 for non-admin account", async () => {
    const regularUser = createTestAccount("regular-user2", "regular2@example.com");

    const response = await invokeRoute<{ message: string }>(adminRoutes, {
      method: "post",
      path: "/badges/grant",
      body: { playerId: "some-id", badgeId: "supporter" },
      cookie: regularUser.cookie,
    });

    assert.equal(response.status, 403);
  });

  test("returns 400 for missing playerId", async () => {
    const response = await invokeRoute<{ message: string }>(adminRoutes, {
      method: "post",
      path: "/badges/grant",
      body: { badgeId: "supporter" },
      cookie: adminCookie,
    });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /required/i);
  });

  test("returns 400 for missing badgeId", async () => {
    const response = await invokeRoute<{ message: string }>(adminRoutes, {
      method: "post",
      path: "/badges/grant",
      body: { playerId: "some-id" },
      cookie: adminCookie,
    });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /required/i);
  });
});

// ─── Badge revoke tests ─────────────────────────────────────────────

describe("POST /badges/revoke", () => {
  test("returns 401 without session cookie", async () => {
    const response = await invokeRoute<{ message: string }>(adminRoutes, {
      method: "post",
      path: "/badges/revoke",
      body: { playerId: "some-id", badgeId: "supporter" },
    });

    assert.equal(response.status, 401);
  });

  test("returns 403 for non-admin account", async () => {
    const regularUser = createTestAccount("regular-user3", "regular3@example.com");

    const response = await invokeRoute<{ message: string }>(adminRoutes, {
      method: "post",
      path: "/badges/revoke",
      body: { playerId: "some-id", badgeId: "supporter" },
      cookie: regularUser.cookie,
    });

    assert.equal(response.status, 403);
  });

  test("returns 400 for missing playerId", async () => {
    const response = await invokeRoute<{ message: string }>(adminRoutes, {
      method: "post",
      path: "/badges/revoke",
      body: { badgeId: "supporter" },
      cookie: adminCookie,
    });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /required/i);
  });

  test("returns 400 for missing badgeId", async () => {
    const response = await invokeRoute<{ message: string }>(adminRoutes, {
      method: "post",
      path: "/badges/revoke",
      body: { playerId: "some-id" },
      cookie: adminCookie,
    });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /required/i);
  });
});
