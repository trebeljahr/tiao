import assert from "node:assert/strict";
import { test } from "node:test";
import { freeHighPort, sandboxEnv } from "./shop-sandbox.mjs";

const input = { mongoPort: 52001, apiPort: 52002, webPort: 52003, secret: "fresh-secret" };
test("sandbox rejects live and malformed Stripe keys", () => {
  for (const key of ["sk_live_danger", "rk_live_danger", "garbage"])
    assert.throws(() => sandboxEnv({ ...input, stripeKey: key }), /Refusing non-test/);
});
test("sandbox does not inherit external services, database, or payment secrets", () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, {
      REDIS_URL: "redis://prod",
      STRIPE_SECRET_KEY: "sk_live_danger",
      MONGODB_URI: "mongodb://prod",
      LISTMONK_API_TOKEN: "prod-token",
      STEAM_MICROTXN_SANDBOX: "false",
      STRIPE_WEBHOOK_SECRET: "whsec_wrong",
    });
    const env = sandboxEnv(input);
    assert.equal(env.NODE_ENV, "test");
    assert.equal(env.MONGODB_URI, "mongodb://127.0.0.1:52001/tiao_shop_sandbox");
    assert.equal(env.STRIPE_SECRET_KEY, "");
    assert.equal(env.STRIPE_WEBHOOK_SECRET, "");
    assert.equal(env.STEAM_MICROTXN_SANDBOX, "true");
    assert.equal(env.TIAO_KEYCHAIN_ACCESS, "deny");
    assert.equal(env.REDIS_URL, undefined);
    assert.equal(env.LISTMONK_API_TOKEN, undefined);
  } finally {
    process.env = saved;
  }
});
test("selects an available high port", async () => {
  const port = await freeHighPort();
  assert.ok(port >= 49152 && port <= 65535);
});
