import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import express from "express";
import * as authModule from "../auth/auth";
import { getExchangeCodeStore, resetExchangeCodeStoreForTests } from "../auth/desktopExchangeStore";

const AUTH_ORIGIN = "https://play.tiao.test";
const API_HOST = "api.play.tiao.test";
const STATE = "native-state-0123456789";
const realAuth = betterAuth({
  baseURL: AUTH_ORIGIN,
  secret: "native-sso-test-secret-at-least-32-characters",
  database: memoryAdapter({}),
  socialProviders: { google: { clientId: "test-client", clientSecret: "test-secret" } },
  onAPIError: { errorURL: `${AUTH_ORIGIN}/error` },
  advanced: { cookiePrefix: "tiao" },
  logger: { level: "error" },
});
(authModule as Record<string, unknown>).auth = realAuth;

import desktopRoutes from "../routes/desktop-auth.routes";
import mobileRoutes from "../routes/mobile-auth.routes";

const app = express();
app.set("trust proxy", 1);
app.use("/api/auth/desktop", desktopRoutes);
app.use("/api/auth/mobile", mobileRoutes);
const server = createServer(app);
let transportOrigin: string;
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  transportOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => resetExchangeCodeStoreForTests());

function request(path: string, host = new URL(AUTH_ORIGIN).host, protocol = "https") {
  return fetch(`${transportOrigin}${path}`, {
    redirect: "manual",
    headers: { "x-forwarded-host": host, "x-forwarded-proto": protocol },
  });
}

function cookiesForCallback(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

// A provider denial still runs Better Auth's real state verification first.
// This tests that verification without sending credentials to a real provider.
async function providerCallback(providerURL: string, cookie: string) {
  const authorize = new URL(providerURL);
  const callback = new URL(authorize.searchParams.get("redirect_uri")!);
  callback.searchParams.set("state", authorize.searchParams.get("state")!);
  callback.searchParams.set("error", "access_denied");
  return realAuth.handler(new Request(callback, { headers: { cookie } }));
}

for (const provider of ["google", "github", "discord", "apple", "steam"]) {
  test(`${provider}: API-host start redirects before setting auth cookies`, async () => {
    const path = `/api/auth/desktop/start?${new URLSearchParams({
      provider,
      state: STATE,
      code_challenge: "a".repeat(43),
      code_challenge_method: "S256",
    })}`;
    const response = await request(path, API_HOST);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), `${AUTH_ORIGIN}${path}`);
    assert.deepEqual(response.headers.getSetCookie(), []);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  });
}

test("canonical browser start sets a cookie accepted by the real provider callback", async () => {
  const path = `/api/auth/desktop/start?provider=google&state=${STATE}`;
  const hop = await request(path, API_HOST);
  const canonical = new URL(hop.headers.get("location")!);
  const start = await request(canonical.pathname + canonical.search, canonical.host);
  assert.equal(start.status, 302);
  const providerURL = start.headers.get("location")!;
  assert.equal(
    new URL(providerURL).searchParams.get("redirect_uri"),
    `${AUTH_ORIGIN}/api/auth/callback/google`,
  );
  assert.match(cookiesForCallback(start), /__Secure-tiao.state=/);
  const callback = await providerCallback(providerURL, cookiesForCallback(start));
  assert.equal(
    new URL(callback.headers.get("location")!).searchParams.get("error"),
    "access_denied",
  );
});

test("state verification still rejects a callback without the browser cookie", async () => {
  const start = await request(`/api/auth/desktop/start?provider=google&state=${STATE}`);
  const callback = await providerCallback(start.headers.get("location")!, "");
  assert.equal(
    new URL(callback.headers.get("location")!).searchParams.get("error"),
    "state_mismatch",
  );
});

test("insecure canonical-host entry upgrades to HTTPS before setting secure cookies", async () => {
  const path = `/api/auth/desktop/start?provider=google&state=${STATE}`;
  const response = await request(path, new URL(AUTH_ORIGIN).host, "http");
  assert.equal(response.headers.get("location"), `${AUTH_ORIGIN}${path}`);
  assert.deepEqual(response.headers.getSetCookie(), []);
});

for (const platform of ["desktop", "mobile"]) {
  test(`${platform}: link ticket survives the host hop, then sets cookies once`, async () => {
    const initiated = await realAuth.api.signInSocial({
      body: { provider: "google", callbackURL: "/linked" },
      asResponse: true,
    });
    const { url } = (await initiated.json()) as { url: string };
    const ticket = `ticket-${platform}`;
    await getExchangeCodeStore().put(
      platform === "desktop" ? `native-begin:${STATE}` : `link:${STATE}`,
      ticket,
      JSON.stringify({ url, cookies: initiated.headers.getSetCookie() }),
      120,
    );
    const path = `/api/auth/${platform}/link/begin?${new URLSearchParams({ state: STATE, ticket })}`;
    const hop = await request(path, API_HOST);
    assert.equal(hop.headers.get("location"), `${AUTH_ORIGIN}${path}`);
    assert.deepEqual(hop.headers.getSetCookie(), []);
    const begin = await request(path);
    assert.equal(begin.headers.get("location"), url);
    assert.deepEqual(begin.headers.getSetCookie(), initiated.headers.getSetCookie());
    const callback = await providerCallback(url, cookiesForCallback(begin));
    assert.equal(
      new URL(callback.headers.get("location")!).searchParams.get("error"),
      "access_denied",
    );
    const replay = await request(path);
    assert.match(replay.headers.get("location")!, /reason=link_expired/);
  });
}
