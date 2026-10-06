import assert from "node:assert/strict";
import { describe, test } from "node:test";

type FetchCall = { url: string; init: RequestInit };

function loadWithEnv(env: Record<string, string | undefined>) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
  }
  // Drop the cached module so each case reads its own env at load time.
  const path = require.resolve("../analytics/plausible");
  delete require.cache[path];
  const mod = require(path) as typeof import("../analytics/plausible");
  process.env = saved;
  return mod;
}

function stubFetch(): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(null, { status: 202 });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

describe("plausible goal events", () => {
  test("posts a goal to the Events API in production", async () => {
    const mod = loadWithEnv({
      NODE_ENV: "production",
      PLAUSIBLE_API_HOST: "https://plausible.example.test/",
      PLAUSIBLE_DOMAIN: "playtiao.com",
    });
    const { calls, restore } = stubFetch();
    try {
      assert.equal(mod.plausibleEnabled, true);
      mod.trackGoal("game_finished", { mode: "matchmaking" });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, "https://plausible.example.test/api/event");
      assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
        name: "game_finished",
        domain: "playtiao.com",
        url: "https://playtiao.com/server/game_finished",
        props: { mode: "matchmaking" },
      });
    } finally {
      restore();
    }
  });

  test("is a no-op outside production or without config", async () => {
    const devMod = loadWithEnv({
      NODE_ENV: "test",
      PLAUSIBLE_API_HOST: "https://plausible.example.test",
      PLAUSIBLE_DOMAIN: "playtiao.com",
    });
    const unconfigured = loadWithEnv({
      NODE_ENV: "production",
      PLAUSIBLE_API_HOST: undefined,
      PLAUSIBLE_DOMAIN: undefined,
    });
    const { calls, restore } = stubFetch();
    try {
      devMod.trackGoal("user_signed_up");
      unconfigured.trackGoal("user_signed_up");
      assert.equal(calls.length, 0);
    } finally {
      restore();
    }
  });
});
