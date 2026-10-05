import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import express from "express";

process.env.TOKEN_SECRET ??= "test-token-secret";
process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/tiao-test";
process.env.S3_BUCKET_NAME ??= "tiao-test-assets";
process.env.S3_PUBLIC_URL ??= "https://assets.test.local";

import mongoose from "mongoose";
import * as authModule from "../auth/auth";
import { nativeAuthCors } from "../middleware/nativeAuthCors";
import GameAccount from "../models/GameAccount";

// ---------------------------------------------------------------------------
// Stubs for POST /player/login: no database, better-auth answers with a
// session cookie plus the bearer plugin's set-auth-token header.
// ---------------------------------------------------------------------------
const signInCalls: Array<{ headers: Record<string, unknown> }> = [];
(authModule as Record<string, unknown>).auth = {
  api: {
    signInEmail: async (opts: { headers: Record<string, unknown> }) => {
      signInCalls.push(opts);
      return new Response(
        JSON.stringify({ user: { id: "507f1f77bcf86cd799439011", email: "a@example.com" } }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "set-cookie": "tiao.session_token=abc.sig; Path=/; HttpOnly; SameSite=Lax",
            "set-auth-token": "abc.sig",
          },
        },
      );
    },
  },
};
(mongoose.connection as unknown as Record<string, unknown>).getClient = () => ({
  db: () => ({ collection: () => ({ findOne: async () => null }) }),
});
(GameAccount as unknown as Record<string, unknown>).findById = async (id: string) => ({
  id,
  displayName: "alice",
  badges: [],
  activeBadges: [],
  unlockedThemes: [],
});

import { configureApp } from "../config";
import gameAuthRoutes from "../routes/game-auth.routes";

function listen(app: express.Express) {
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    const server = createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}

describe("native auth CORS on /api/auth", () => {
  let ctx: Awaited<ReturnType<typeof listen>>;
  before(async () => {
    const app = express();
    app.use("/api/auth", nativeAuthCors);
    app.all("/api/auth/*splat", (_req, res) => {
      res.setHeader("set-auth-token", "tok.sig");
      res.json({ ok: true });
    });
    ctx = await listen(app);
  });
  after(() => ctx.close());

  for (const origin of ["capacitor://localhost", "https://localhost"]) {
    test(`allows ${origin} without credentials and exposes set-auth-token`, async () => {
      const pre = await fetch(`${ctx.url}/api/auth/sign-in/anonymous`, {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization,content-type",
        },
      });
      assert.equal(pre.headers.get("access-control-allow-origin"), origin);
      assert.equal(pre.headers.get("access-control-allow-credentials"), null);
      assert.match(pre.headers.get("access-control-allow-headers") ?? "", /authorization/i);

      const res = await fetch(`${ctx.url}/api/auth/sign-in/anonymous`, {
        method: "POST",
        headers: { origin },
      });
      assert.equal(res.headers.get("access-control-allow-origin"), origin);
      assert.match(res.headers.get("access-control-expose-headers") ?? "", /set-auth-token/);
    });
  }

  test("adds nothing for other origins", async () => {
    const res = await fetch(`${ctx.url}/api/auth/sign-in/anonymous`, {
      method: "POST",
      headers: { origin: "https://attacker.example" },
    });
    assert.equal(res.headers.get("access-control-allow-origin"), null);
    const pre = await fetch(`${ctx.url}/api/auth/sign-in/anonymous`, {
      method: "OPTIONS",
      headers: { origin: "https://attacker.example", "access-control-request-method": "POST" },
    });
    assert.equal(pre.headers.get("access-control-allow-origin"), null);
  });
});

describe("POST /player/login from a native app", () => {
  let ctx: Awaited<ReturnType<typeof listen>>;
  before(async () => {
    const app = express();
    configureApp(app);
    app.use("/api/player", gameAuthRoutes);
    ctx = await listen(app);
  });
  after(() => ctx.close());

  test("forwards set-auth-token and the guest bearer to better-auth", async () => {
    const res = await fetch(`${ctx.url}/api/player/login`, {
      method: "POST",
      headers: {
        origin: "capacitor://localhost",
        "content-type": "application/json",
        authorization: "Bearer guest.sig",
      },
      body: JSON.stringify({ identifier: "a@example.com", password: "password123" }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("set-auth-token"), "abc.sig");
    assert.match(res.headers.get("access-control-expose-headers") ?? "", /set-auth-token/);
    // The guest's bearer reaches better-auth so the anonymous plugin can
    // migrate the guest's games to the account.
    assert.equal(signInCalls.at(-1)?.headers.authorization, "Bearer guest.sig");
  });
});
