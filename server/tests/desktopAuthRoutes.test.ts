import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { beforeEach, describe, test } from "node:test";
import express from "express";

process.env.TOKEN_SECRET ??= "test-token-secret";
process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/tiao-test";
process.env.S3_BUCKET_NAME ??= "tiao-test-assets";
process.env.S3_PUBLIC_URL ??= "https://assets.test.local";

import * as bearerSessionModule from "../auth/bearerSession";
import {
  DEFAULT_EXCHANGE_TTL_SEC,
  generateCode,
  getExchangeCodeStore,
  resetExchangeCodeStoreForTests,
} from "../auth/desktopExchangeStore";
import { verifySessionToken } from "../auth/desktopSessionManager";
import { installFakeDesktopSessions } from "./fakeDesktopSessions";

const fakeSessions = installFakeDesktopSessions();

import desktopAuthRoutes, {
  codeChallengeFromVerifier,
  verifierMatchesChallenge,
} from "../routes/desktop-auth.routes";

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
    await getExchangeCodeStore().put(
      state,
      code,
      JSON.stringify({
        userId: "user-happy",
        sourceSessionId: "fake-browser-session",
        securityState: "fake-security-state",
      }),
      DEFAULT_EXCHANGE_TTL_SEC,
    );

    const res = await post(ctx.url, "/api/auth/desktop/exchange", { state, code });
    assert.equal(res.status, 200);
    assert.equal(res.body.userId, "user-happy");
    assert.ok(typeof res.body.sessionToken === "string");
    assert.ok(typeof res.body.expiresAt === "number");

    // The returned token should verify to the same userId.
    const payload = await verifySessionToken(res.body.sessionToken as string);
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
    await getExchangeCodeStore().put(
      state,
      code,
      JSON.stringify({
        userId: "user-mismatch",
        sourceSessionId: "fake-browser-session",
        securityState: "fake-security-state",
      }),
      DEFAULT_EXCHANGE_TTL_SEC,
    );

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

describe("PKCE on the mobile exchange", () => {
  let ctx: Awaited<ReturnType<typeof makeTestServer>>;
  const verifier = "a-verifier_with.unreserved~chars-0123456789";
  const challenge = codeChallengeFromVerifier(verifier);

  beforeEach(async () => {
    resetExchangeCodeStoreForTests();
    ctx = await makeTestServer();
  });

  async function putWithChallenge(state: string, code: string) {
    await getExchangeCodeStore().put(
      state,
      code,
      JSON.stringify({
        userId: "user-pkce",
        sourceSessionId: "fake-browser-session",
        securityState: "fake-security-state",
        codeChallenge: challenge,
      }),
      DEFAULT_EXCHANGE_TTL_SEC,
    );
  }

  test("S256: BASE64URL(SHA-256(verifier)), 43 chars", async () => {
    assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(verifierMatchesChallenge(verifier, challenge), true);
    assert.equal(verifierMatchesChallenge("short", challenge), false);
    assert.equal(verifierMatchesChallenge(undefined, challenge), false);
    await ctx.close();
  });

  test("exchange succeeds with the matching verifier", async () => {
    const code = generateCode();
    await putWithChallenge("state-pkce-ok", code);
    const res = await post(ctx.url, "/api/auth/desktop/exchange", {
      state: "state-pkce-ok",
      code,
      code_verifier: verifier,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.userId, "user-pkce");
    await ctx.close();
  });

  test("an intercepted state + code without the verifier is useless and burnt", async () => {
    const code = generateCode();
    await putWithChallenge("state-pkce-stolen", code);
    const stolen = await post(ctx.url, "/api/auth/desktop/exchange", {
      state: "state-pkce-stolen",
      code,
    });
    assert.equal(stolen.status, 401);
    const wrong = await post(ctx.url, "/api/auth/desktop/exchange", {
      state: "state-pkce-stolen",
      code,
      code_verifier: "x".repeat(43),
    });
    assert.equal(wrong.status, 401);
    await ctx.close();
  });

  test("a wrong verifier burns the code even for the real client", async () => {
    const code = generateCode();
    await putWithChallenge("state-pkce-wrong", code);
    const wrong = await post(ctx.url, "/api/auth/desktop/exchange", {
      state: "state-pkce-wrong",
      code,
      code_verifier: "y".repeat(43),
    });
    assert.equal(wrong.status, 401);
    const late = await post(ctx.url, "/api/auth/desktop/exchange", {
      state: "state-pkce-wrong",
      code,
      code_verifier: verifier,
    });
    assert.equal(late.status, 401);
    await ctx.close();
  });
});

describe("token_type=session on the mobile exchange", () => {
  let ctx: Awaited<ReturnType<typeof makeTestServer>>;
  const verifier = "a-verifier_with.unreserved~chars-0123456789";
  const challenge = codeChallengeFromVerifier(verifier);
  const minted: string[] = [];

  beforeEach(async () => {
    resetExchangeCodeStoreForTests();
    fakeSessions.setSecurityState("fake-security-state");
    minted.length = 0;
    (bearerSessionModule as Record<string, unknown>).mintBearerSession = async (userId: string) => {
      minted.push(userId);
      return { token: `ba-session-for-${userId}.sig`, expiresAt: Date.now() + 1000 };
    };
    ctx = await makeTestServer();
  });

  async function put(state: string, code: string, withChallenge: boolean) {
    await getExchangeCodeStore().put(
      state,
      code,
      JSON.stringify({
        userId: "user-native",
        sourceSessionId: "fake-browser-session",
        securityState: "fake-security-state",
        ...(withChallenge ? { codeChallenge: challenge } : {}),
      }),
      DEFAULT_EXCHANGE_TTL_SEC,
    );
  }

  test("returns a better-auth session token for a PKCE flow", async () => {
    const code = generateCode();
    await put("state-native", code, true);
    const res = await post(ctx.url, "/api/auth/desktop/exchange", {
      state: "state-native",
      code,
      code_verifier: verifier,
      token_type: "session",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.tokenType, "session");
    assert.equal(res.body.sessionToken, "ba-session-for-user-native.sig");
    assert.deepEqual(minted, ["user-native"]);
    await ctx.close();
  });

  test("refuses a session token without PKCE", async () => {
    const code = generateCode();
    await put("state-no-pkce", code, false);
    const res = await post(ctx.url, "/api/auth/desktop/exchange", {
      state: "state-no-pkce",
      code,
      token_type: "session",
    });
    assert.equal(res.status, 401);
    assert.deepEqual(minted, []);
    await ctx.close();
  });

  test("refuses when the account's security state changed since the callback", async () => {
    const code = generateCode();
    await put("state-changed", code, true);
    fakeSessions.setSecurityState("password-changed");
    const res = await post(ctx.url, "/api/auth/desktop/exchange", {
      state: "state-changed",
      code,
      code_verifier: verifier,
      token_type: "session",
    });
    assert.equal(res.status, 401);
    assert.deepEqual(minted, []);
    await ctx.close();
  });

  test("rejects unknown token types before consuming the code", async () => {
    const code = generateCode();
    await put("state-bad-type", code, true);
    const bad = await post(ctx.url, "/api/auth/desktop/exchange", {
      state: "state-bad-type",
      code,
      code_verifier: verifier,
      token_type: "jwt",
    });
    assert.equal(bad.status, 400);
    const ok = await post(ctx.url, "/api/auth/desktop/exchange", {
      state: "state-bad-type",
      code,
      code_verifier: verifier,
      token_type: "session",
    });
    assert.equal(ok.status, 200);
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
    await getExchangeCodeStore().put(
      state,
      code,
      JSON.stringify({
        userId: "user-refresh",
        sourceSessionId: "fake-browser-session",
        securityState: "fake-security-state",
      }),
      DEFAULT_EXCHANGE_TTL_SEC,
    );
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
    const payload = await verifySessionToken(refresh.body.sessionToken as string);
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

  test("400 when code_challenge is malformed or not S256", async () => {
    const good = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    for (const query of [
      `code_challenge=${good}`,
      `code_challenge=${good}&code_challenge_method=plain`,
      "code_challenge=too-short&code_challenge_method=S256",
    ]) {
      const res = await fetch(
        `${ctx.url}/api/auth/desktop/start?provider=google&state=abc&${query}`,
      );
      assert.equal(res.status, 400, query);
      const body = await res.json();
      assert.equal(body.code, "INVALID_CODE_CHALLENGE", query);
    }
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

  test("bounces a tampered tiao_challenge back to the app as an error", async () => {
    const res = await fetch(
      `${ctx.url}/api/auth/desktop/callback?tiao_state=s1&tiao_challenge=bad`,
      {
        redirect: "manual",
      },
    );
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "tiao://auth/error?state=s1&reason=bad_request");
    await ctx.close();
  });

  test("400 when tiao_state is missing", async () => {
    const res = await fetch(`${ctx.url}/api/auth/desktop/callback`, { redirect: "manual" });
    assert.equal(res.status, 400);
    const body = await res.text();
    assert.match(body, /state/i);
    await ctx.close();
  });
});

test("logout revokes refreshed credentials and rejects subsequent refresh", async () => {
  installFakeDesktopSessions();
  const ctx = await makeTestServer();
  try {
    const state = "logout-state",
      code = generateCode();
    await getExchangeCodeStore().put(
      state,
      code,
      JSON.stringify({
        userId: "logout-user",
        sourceSessionId: "fake-browser-session",
        securityState: "fake-security-state",
      }),
      DEFAULT_EXCHANGE_TTL_SEC,
    );
    const exchange = await post(ctx.url, "/api/auth/desktop/exchange", { state, code });
    const original = exchange.body.sessionToken;
    const refresh = await post(ctx.url, "/api/auth/desktop/refresh", { sessionToken: original });
    assert.equal(refresh.status, 200);
    assert.equal(
      (await post(ctx.url, "/api/auth/desktop/refresh", { sessionToken: original })).status,
      401,
    );
    assert.equal(
      (await post(ctx.url, "/api/auth/desktop/logout", { sessionToken: original })).status,
      200,
    );
    assert.equal(
      (
        await post(ctx.url, "/api/auth/desktop/refresh", {
          sessionToken: refresh.body.sessionToken,
        })
      ).status,
      401,
    );
  } finally {
    await ctx.close();
  }
});
