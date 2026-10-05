import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, test } from "node:test";
import express from "express";

process.env.TOKEN_SECRET ??= "test-token-secret";
process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/tiao-test";
process.env.S3_BUCKET_NAME ??= "tiao-test-assets";
process.env.S3_PUBLIC_URL ??= "https://assets.test.local";

import * as authModule from "../auth/auth";
import { resetExchangeCodeStoreForTests } from "../auth/desktopExchangeStore";

type SessionStub = { user: { id: string; isAnonymous?: boolean } } | null;
let sessionForToken: Record<string, SessionStub> = {};
const linkCalls: Array<{ headers: Headers; body: Record<string, unknown> }> = [];
let linkResponse: () => Response = () =>
  new Response(
    JSON.stringify({ url: "https://accounts.example/authorize?state=s", redirect: false }),
    {
      status: 200,
      headers: [
        ["content-type", "application/json"],
        ["set-cookie", "tiao.state=abc.sig; Path=/; HttpOnly; Secure; SameSite=Lax"],
        ["set-cookie", "tiao.other=1; Path=/"],
      ],
    },
  );

(authModule as Record<string, unknown>).auth = {
  api: {
    getSession: async ({ headers }: { headers: Headers }) => {
      const token = headers.get("authorization")?.slice(7) ?? "";
      return sessionForToken[token] ?? null;
    },
    linkSocialAccount: async (opts: { headers: Headers; body: Record<string, unknown> }) => {
      linkCalls.push(opts);
      return linkResponse();
    },
  },
};

import mobileAuthRoutes from "../routes/mobile-auth.routes";

const STATE = "state-0123456789abcdef";

function startServer() {
  const app = express();
  app.use(express.json());
  app.use("/api/auth/mobile", mobileAuthRoutes);
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

function start(url: string, body: Record<string, unknown>, token?: string) {
  return fetch(`${url}/api/auth/mobile/link/start`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("native account linking", () => {
  let ctx: Awaited<ReturnType<typeof startServer>>;
  before(async () => {
    ctx = await startServer();
  });
  after(() => ctx.close());
  beforeEach(() => {
    resetExchangeCodeStoreForTests();
    linkCalls.length = 0;
    sessionForToken = {
      "account.sig": { user: { id: "user-1" } },
      "guest.sig": { user: { id: "guest-1", isAnonymous: true } },
    };
  });

  test("start requires a bearer token", async () => {
    const res = await start(ctx.url, { provider: "google", state: STATE });
    assert.equal(res.status, 401);
    const bad = await start(ctx.url, { provider: "google", state: STATE }, "unknown.sig");
    assert.equal(bad.status, 401);
    assert.equal(linkCalls.length, 0);
  });

  test("guests cannot link", async () => {
    const res = await start(ctx.url, { provider: "google", state: STATE }, "guest.sig");
    assert.equal(res.status, 403);
    assert.equal(linkCalls.length, 0);
  });

  test("validates provider and state", async () => {
    assert.equal(
      (await start(ctx.url, { provider: "myspace", state: STATE }, "account.sig")).status,
      400,
    );
    assert.equal(
      (await start(ctx.url, { provider: "google", state: "short" }, "account.sig")).status,
      400,
    );
    assert.equal(
      (await start(ctx.url, { provider: "google", state: `${STATE}&x=1` }, "account.sig")).status,
      400,
    );
  });

  test("start → begin sets the state cookies once and sends the browser to the provider", async () => {
    const res = await start(ctx.url, { provider: "github", state: STATE }, "account.sig");
    assert.equal(res.status, 200);
    const { path } = (await res.json()) as { path: string };
    assert.match(path, /^\/api\/auth\/mobile\/link\/begin\?state=.+&ticket=.+$/);
    assert.ok(!path.includes("account.sig"), "the session token never appears in the URL");

    assert.equal(linkCalls.length, 1);
    assert.equal(linkCalls[0].headers.get("authorization"), "Bearer account.sig");
    assert.equal(linkCalls[0].body.provider, "github");
    assert.equal(
      linkCalls[0].body.callbackURL,
      `/api/auth/mobile/link/callback?tiao_state=${STATE}`,
    );

    const begin = await fetch(`${ctx.url}${path}`, { redirect: "manual" });
    assert.equal(begin.status, 302);
    assert.equal(begin.headers.get("location"), "https://accounts.example/authorize?state=s");
    assert.equal(begin.headers.get("referrer-policy"), "no-referrer");
    assert.equal(begin.headers.getSetCookie().length, 2);

    const replay = await fetch(`${ctx.url}${path}`, { redirect: "manual" });
    assert.equal(
      replay.headers.get("location"),
      `tiao://auth/error?state=${STATE}&reason=link_expired`,
    );
    assert.equal(replay.headers.getSetCookie().length, 0);
  });

  test("a ticket only works with its own state", async () => {
    const res = await start(ctx.url, { provider: "github", state: STATE }, "account.sig");
    const { path } = (await res.json()) as { path: string };
    const ticket = new URL(path, ctx.url).searchParams.get("ticket") ?? "";
    const other = await fetch(
      `${ctx.url}/api/auth/mobile/link/begin?state=other-state-0123456789&ticket=${ticket}`,
      { redirect: "manual" },
    );
    assert.match(other.headers.get("location") ?? "", /reason=link_expired/);
  });

  test("passes better-auth refusals through", async () => {
    linkResponse = () =>
      new Response(JSON.stringify({ code: "SOCIAL_ACCOUNT_ALREADY_LINKED", message: "taken" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      });
    const res = await start(ctx.url, { provider: "google", state: STATE }, "account.sig");
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as { code: string }).code, "SOCIAL_ACCOUNT_ALREADY_LINKED");
  });

  test("callback deep-links back to the app", async () => {
    const ok = await fetch(`${ctx.url}/api/auth/mobile/link/callback?tiao_state=${STATE}`, {
      redirect: "manual",
    });
    assert.equal(ok.headers.get("location"), `tiao://auth/linked?state=${STATE}`);

    const failed = await fetch(
      `${ctx.url}/api/auth/mobile/link/callback?tiao_state=${STATE}&failed=1&error=account_already_linked_to_different_user`,
      { redirect: "manual" },
    );
    assert.equal(
      failed.headers.get("location"),
      `tiao://auth/error?state=${STATE}&reason=account_already_linked_to_different_user`,
    );

    const odd = await fetch(
      `${ctx.url}/api/auth/mobile/link/callback?tiao_state=${STATE}&error=%3Cscript%3E`,
      { redirect: "manual" },
    );
    assert.equal(
      odd.headers.get("location"),
      `tiao://auth/error?state=${STATE}&reason=link_failed`,
    );

    const missing = await fetch(`${ctx.url}/api/auth/mobile/link/callback`, { redirect: "manual" });
    assert.equal(missing.status, 400);
  });
});
