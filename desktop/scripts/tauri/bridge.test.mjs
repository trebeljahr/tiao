import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const script = readFileSync(new URL("../../bridge.js", import.meta.url), "utf8");
async function bridge() {
  const calls = [];
  let delivery;
  const window = {
    __TAURI__: {
      core: {
        invoke: async (channel, args) => {
          calls.push({ command: channel, ...args });
          return args.channel === "runtime:ready"
            ? [{ channel: "auth:complete", payload: { userId: "queued" } }]
            : true;
        },
      },
      event: {
        listen: async (_, cb) => {
          delivery = cb;
        },
      },
    },
  };
  runInNewContext(
    script.replace(
      "__TIAO_CONFIG__",
      JSON.stringify({
        distributionChannel: "steam",
        isSteamBuild: true,
        isSteamDemo: true,
        apiUrl: "https://api.playtiao.com",
        version: "1.0.0",
        platform: "darwin",
      }),
    ),
    { window, document: { addEventListener() {} }, URL, console },
  );
  return {
    api: window.electron,
    calls,
    emit: (channel, payload) => delivery({ payload: { channel, payload } }),
  };
}
test("bridge exposes runtime metadata before frontend initialization and routes calls", async () => {
  const { api, calls } = await bridge();
  assert.equal(api.config.distributionChannel, "steam");
  assert.equal(api.config.isSteamDemo, true);
  assert.ok(Object.isFrozen(api.config));
  await api.auth.login("player", "password");
  assert.equal(calls.at(-1).command, "desktop_call");
  assert.equal(calls.at(-1).args.join(","), "player,password");
  assert.equal(calls.at(-1).channel, "auth:login");
});
test("event subscriptions can unsubscribe and preserve payloads", async () => {
  const { api, emit } = await bridge();
  const received = [];
  const unsubscribe = api.steam.onMicroTxnAuthorization((value) => received.push(value));
  emit("steam:microTxnAuthorization", { orderId: "123" });
  unsubscribe();
  emit("steam:microTxnAuthorization", { orderId: "456" });
  assert.deepEqual(received, [{ orderId: "123" }]);
});

test("checkout return survives frontend mounting after native ready", async () => {
  const { api, emit } = await bridge();
  const received = [];
  emit("checkout:return", { sessionId: "cs_test_123" });
  const unsubscribe = api.checkout.onReturn((value) => received.push(value));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(received, [{ sessionId: "cs_test_123" }]);
  unsubscribe();
  emit("checkout:return", { sessionId: "cs_test_other" });
  assert.equal(received.length, 1);
});

test("startup auth delivery survives frontend mounting after native ready", async () => {
  const { api } = await bridge();
  await new Promise((resolve) => setImmediate(resolve));
  const received = [];
  api.auth.onAuthComplete((value) => received.push(value));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(received[0].userId, "queued");
});

test("Steam linking preserves options, account confirmation and cancellation", async () => {
  const { api, calls, emit } = await bridge();
  await api.auth.login("player", "password", { linkSteam: true });
  assert.equal(calls.at(-1).args[2].linkSteam, true);
  await api.auth.startOAuth("google", { linkSteam: true });
  assert.equal(calls.at(-1).args[1].linkSteam, true);
  const names = [];
  api.auth.onSteamLinkReady((value) => names.push(value.displayName));
  emit("auth:steamLinkReady", { displayName: "Player" });
  assert.deepEqual(names, ["Player"]);
  await api.auth.confirmSteamLink();
  assert.equal(calls.at(-1).channel, "auth:confirmSteamLink");
  await api.auth.cancelOAuth();
  assert.equal(calls.at(-1).channel, "auth:cancelOAuth");
});
