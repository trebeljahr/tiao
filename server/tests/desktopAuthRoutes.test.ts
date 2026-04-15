import assert from "node:assert/strict";
import { describe, test, beforeEach } from "node:test";
import express from "express";
import { AddressInfo } from "node:net";
import { createServer, Server } from "node:http";

process.env.TOKEN_SECRET ??= "test-token-secret";
process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/tiao-test";
process.env.S3_BUCKET_NAME ??= "tiao-test-assets";
process.env.S3_PUBLIC_URL ??= "https://assets.test.local";

import desktopAuthRoutes from "../routes/desktop-auth.routes";
import {
  resetExchangeCodeStoreForTests,
  getExchangeCodeStore,
  DEFAULT_EXCHANGE_TTL_SEC,
  generateCode,
} from "../auth/desktopExchangeStore";
import { verifySessionToken } from "../auth/desktopSessionManager";

/**
 * Spin up a minimal Express app with just the desktop auth router and
 * the JSON body parser it needs.  We test /exchange and /refresh here
 * because they don't depend on better-auth's OAuth flow — those are
 * integration concerns we'll cover in commit 9 with a real Electron
 * end-to-end.
 */
function makeTestServer(): Promise<{ server: Server; url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json({ limit: "10kb" }));
  app.use("/api/auth/desktop", desktopAuthRoutes);

  return new Promise((resolve, reject) => {
    const server = createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      const url = `http://127.0.0.1:${addr.port}`;
      resolve({
        server,
        url,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
    server.on("error", reject);
  });
}

async function post(
  url: string,
  path: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("POST /api/auth/desktop/exchange", () => {
  let ctx: Awaited<ReturnType<typeof makeTestServer>>;

  beforeEach(async () => {
    resetExchangeCodeStoreForTests();
    ctx = await makeTestServer();
  });

  test("400 when state is missing", async () => {
    const res = await post(ctx.url, "/api/auth/desktop/exchange", { code: "x" });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, "BAD_REQUEST");
    await ctx.close();
  });

  test("400 when code is missing", async () => {
    const res = await post(ctx.url, "/api/auth/desktop/exchange", { state: "x" });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, "BAD_REQUEST");
    await ctx.close();
  });

  test("401 when code is not in the store", async () => {
    const res = await post(ctx.url, "/api/auth/desktop/exchange", {
      state: "unknown",
      code: "unknown",
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.code, "EXCHANGE_FAILED");
    await ctx.close();
  });

  test("happy path: consumes the code and returns a valid bearer token", async () => {
    const state = "state-happy";
    const code = generateCode();
    await getExchangeCodeStore().put(state, code, "user-happy", DEFAULT_EXCHANGE_TTL_SEC);

    const res = await post(ctx.url, "/api/auth/desktop/exchange", { state, code });
    assert.equal(res.status, 200);
    assert.equal(res.body.userId, "user-happy");
    assert.ok(typeof res.body.sessionToken === "string");
    assert.ok(typeof res.body.expiresAt === "number");

    // The returned token should verify to the same userId.
    const payload = verifySessionToken(res.body.sessionToken as string);
    assert.ok(payload);
    assert.equal(payload.userId, "user-happy");

    // Second exchange for the same state/code is rejected (single-use).
    const res2 = await post(ctx.url, "/api/auth/desktop/exchange", { state, code });
    assert.equal(res2.status, 401);
    assert.equal(res2.body.code, "EXCHANGE_FAILED");

    await ctx.close();
  });

  test("wrong code for a valid state still fails and invalidates the entry", async () => {
    const state = "state-mismatch";
    const code = generateCode();
    await getExchangeCodeStore().put(state, code, "user-mismatch", DEFAULT_EXCHANGE_TTL_SEC);

    const bad = await post(ctx.url, "/api/auth/desktop/exchange", {
      state,
      code: "wrong-code",
    });
    assert.equal(bad.status, 401);

    // Even the correct code doesn't work anymore.
    const good = await post(ctx.url, "/api/auth/desktop/exchange", { state, code });
    assert.equal(good.status, 401);

    await ctx.close();
  });
});

describe("POST /api/auth/desktop/refresh", () => {
  let ctx: Awaited<ReturnType<typeof makeTestServer>>;

  beforeEach(async () => {
    resetExchangeCodeStoreForTests();
    ctx = await makeTestServer();
  });

  test("400 when sessionToken is missing", async () => {
    const res = await post(ctx.url, "/api/auth/desktop/refresh", {});
    assert.equal(res.status, 400);
    assert.equal(res.body.code, "BAD_REQUEST");
    await ctx.close();
  });

  test("401 when sessionToken is invalid", async () => {
    const res = await post(ctx.url, "/api/auth/desktop/refresh", {
      sessionToken: "not-a-real-token",
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.code, "INVALID_TOKEN");
    await ctx.close();
  });

  test("happy path: swaps a valid token for a new one", async () => {
    // Mint a valid starting token via /exchange
    const state = "state-refresh";
    const code = generateCode();
    await getExchangeCodeStore().put(state, code, "user-refresh", DEFAULT_EXCHANGE_TTL_SEC);
    const exchange = await post(ctx.url, "/api/auth/desktop/exchange", { state, code });
    const originalToken = exchange.body.sessionToken as string;
    assert.ok(originalToken);

    // Refresh it
    const refresh = await post(ctx.url, "/api/auth/desktop/refresh", {
      sessionToken: originalToken,
    });
    assert.equal(refresh.status, 200);
    assert.equal(refresh.body.userId, "user-refresh");
    assert.ok(typeof refresh.body.sessionToken === "string");
    assert.notEqual(refresh.body.sessionToken, originalToken, "new token should differ (nonce)");

    // The new token verifies to the same user.
    const payload = verifySessionToken(refresh.body.sessionToken as string);
    assert.ok(payload);
    assert.equal(payload.userId, "user-refresh");

    await ctx.close();
  });
});

describe("GET /api/auth/desktop/start validation", () => {
  let ctx: Awaited<ReturnType<typeof makeTestServer>>;

  beforeEach(async () => {
    ctx = await makeTestServer();
  });

  test("400 when provider is missing", async () => {
    const res = await fetch(`${ctx.url}/api/auth/desktop/start?state=abc`);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, "INVALID_PROVIDER");
    await ctx.close();
  });

  test("400 when provider is not in the allow-list", async () => {
    const res = await fetch(`${ctx.url}/api/auth/desktop/start?provider=evil&state=abc`);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, "INVALID_PROVIDER");
    await ctx.close();
  });

  test("400 when state is missing", async () => {
    const res = await fetch(`${ctx.url}/api/auth/desktop/start?provider=google`);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, "INVALID_STATE");
    await ctx.close();
  });

  test("400 when state is too long", async () => {
    const longState = "x".repeat(300);
    const res = await fetch(`${ctx.url}/api/auth/desktop/start?provider=google&state=${longState}`);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, "INVALID_STATE");
    await ctx.close();
  });
});

describe("GET /api/auth/desktop/callback validation", () => {
  let ctx: Awaited<ReturnType<typeof makeTestServer>>;

  beforeEach(async () => {
    ctx = await makeTestServer();
  });

  test("400 when tiao_state is missing", async () => {
    const res = await fetch(`${ctx.url}/api/auth/desktop/callback`, { redirect: "manual" });
    assert.equal(res.status, 400);
    const body = await res.text();
    assert.match(body, /state/i);
    await ctx.close();
  });
});
