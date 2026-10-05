import assert from "node:assert/strict";
import { describe, test } from "node:test";

process.env.TOKEN_SECRET ??= "test-token-secret";
process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/tiao-test";
process.env.S3_BUCKET_NAME ??= "tiao-test-assets";
process.env.S3_PUBLIC_URL ??= "https://assets.test.local";

import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { anonymous, bearer } from "better-auth/plugins";
import {
  type BearerAuth,
  bearerSessions,
  isDesktopToken,
  signSessionToken,
} from "../auth/bearerSession";

const API = "http://localhost:3000";
const NATIVE = "capacitor://localhost";

/** Same plugin set as auth/auth.ts, on an in-memory database. */
function makeAuth() {
  const db: Record<string, unknown[]> = { user: [], session: [], account: [], verification: [] };
  const instance = betterAuth({
    baseURL: API,
    basePath: "/api/auth",
    secret: "bearer-session-test-secret-0123456789abcdef",
    database: memoryAdapter(db as never),
    emailAndPassword: { enabled: true },
    logger: { disabled: true },
    plugins: [bearer({ requireSignature: true }), anonymous()],
    trustedOrigins: [NATIVE],
    // better-auth turns origin/CSRF checks off under NODE_ENV=test.
    advanced: { disableOriginCheck: false, disableCSRFCheck: false },
  });
  return { instance, db };
}

function nativePost(path: string, body: unknown, token?: string) {
  const headers: Record<string, string> = {
    origin: NATIVE,
    "content-type": "application/json",
    "sec-fetch-site": "cross-site",
    "sec-fetch-mode": "cors",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(`${API}/api/auth${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("bearer sessions", () => {
  test("a guest session returns a token the API accepts as Authorization: Bearer", async () => {
    const { instance } = makeAuth();
    const res = await instance.handler(nativePost("/sign-in/anonymous", {}));
    assert.equal(res.status, 200);
    const token = res.headers.get("set-auth-token");
    assert.ok(token, "set-auth-token header is returned");
    assert.match(res.headers.get("access-control-expose-headers") ?? "", /set-auth-token/);

    const { verifyBearerToken } = bearerSessions(
      instance as unknown as BearerAuth,
      async () => null,
    );
    const resolved = await verifyBearerToken(token);
    assert.ok(resolved?.userId);
  });

  test("signing up from a guest bearer session upgrades the guest", async () => {
    const { instance, db } = makeAuth();
    const guest = await instance.handler(nativePost("/sign-in/anonymous", {}));
    const guestToken = guest.headers.get("set-auth-token") ?? "";
    const res = await instance.handler(
      nativePost(
        "/sign-up/email",
        { email: "native@example.com", password: "password123", name: "native" },
        guestToken,
      ),
    );
    assert.equal(res.status, 200);
    assert.ok(res.headers.get("set-auth-token"));
    const users = db.user as Array<{ email: string; isAnonymous?: boolean }>;
    assert.deepEqual(
      users.map((u) => u.email),
      ["native@example.com"],
      "the anonymous user is removed after linking",
    );
  });

  test("minted sessions verify, unsigned or forged tokens do not", async () => {
    const { instance } = makeAuth();
    const guest = await instance.handler(nativePost("/sign-in/anonymous", {}));
    const sessions = bearerSessions(instance as unknown as BearerAuth, async () => null);
    const userId = (await sessions.verifyBearerToken(guest.headers.get("set-auth-token")))?.userId;
    assert.ok(userId);

    const minted = await sessions.mintBearerSession(userId);
    assert.ok(minted.expiresAt > Date.now());
    assert.equal((await sessions.verifyBearerToken(minted.token))?.userId, userId);

    const raw = minted.token.split(".")[0];
    assert.equal(await sessions.verifyBearerToken(raw), null, "unsigned token");
    assert.equal(
      await sessions.verifyBearerToken(signSessionToken(raw, "some-other-secret")),
      null,
      "wrong signature",
    );
    assert.equal(await sessions.verifyBearerToken(""), null);
    assert.equal(await sessions.verifyBearerToken("x".repeat(3000)), null);
  });

  test("sign-out with the bearer token revokes it", async () => {
    const { instance } = makeAuth();
    const guest = await instance.handler(nativePost("/sign-in/anonymous", {}));
    const token = guest.headers.get("set-auth-token") ?? "";
    const out = await instance.handler(nativePost("/sign-out", {}, token));
    assert.equal(out.status, 200);
    const { verifyBearerToken } = bearerSessions(
      instance as unknown as BearerAuth,
      async () => null,
    );
    assert.equal(await verifyBearerToken(token), null);
  });

  test("an untrusted origin cannot sign in with a password", async () => {
    const { instance } = makeAuth();
    await instance.handler(
      nativePost("/sign-up/email", { email: "a@example.com", password: "password123", name: "a" }),
    );
    const req = nativePost("/sign-in/email", { email: "a@example.com", password: "password123" });
    req.headers.set("origin", "https://attacker.example");
    const res = await instance.handler(req);
    assert.equal(res.status, 403);
  });

  test("desktop v2 tokens are routed to the desktop verifier", async () => {
    const { instance } = makeAuth();
    const seen: string[] = [];
    const { verifyBearerToken } = bearerSessions(instance as unknown as BearerAuth, async (t) => {
      seen.push(t);
      return { userId: "desktop-user" };
    });
    assert.ok(isDesktopToken("v2.body.sig"));
    assert.deepEqual(await verifyBearerToken("v2.body.sig"), { userId: "desktop-user" });
    assert.deepEqual(seen, ["v2.body.sig"]);
  });
});
