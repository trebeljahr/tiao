import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../../src/steam.cjs", import.meta.url), "utf8");

function load(demo) {
  const calls = [];
  const record = (name) => (...args) => {
    calls.push([name, ...args]);
    return true;
  };
  const client = {
    achievement: {
      activate: record("achievement"),
      indicateAchievementProgress: record("progress"),
      isActivated: record("read"),
    },
    stats: { setInt: record("stats"), store: record("store") },
    overlay: { activateDialog: record("overlay") },
    auth: {
      getAuthTicketForWebApi: async () => {
        calls.push(["ticket"]);
        return { getBytes: () => [1, 2] };
      },
    },
    callback: { register: record("callback") },
  };
  const module = { exports: {} };
  runInNewContext(source, {
    module,
    Buffer,
    console,
    process: { env: { TIAO_STEAM_APPID: "480" } },
    require(name) {
      if (name === "../package.json") {
        return { steamBuild: true, steamDemo: demo, steamAppId: demo ? 5491870 : 5035580 };
      }
      if (name === "steamworks.js") {
        return {
          restartAppIfNecessary: (id) => {
            calls.push(["restart", id]);
            return false;
          },
          init: (id) => {
            calls.push(["init", id]);
            return client;
          },
        };
      }
      throw Error(name);
    },
  });
  return { steam: module.exports, calls };
}

test("demo boots its own app, keeps overlay, and never writes progress or starts purchases", async () => {
  const { steam, calls } = load(true);
  assert.equal(steam.STEAM_DEMO, true);
  steam.maybeRestartForSteam(true);
  steam.initSteam();
  assert.equal(steam.isSteamActive(), true);
  assert.deepEqual(calls, [["restart", 5491870], ["init", 5491870]]);
  steam.unlockAchievement("FIRST_GAME");
  steam.indicateAchievementProgress("FIRST_GAME", 1, 2);
  assert.equal(Object.keys(steam.getAchievementStates(["FIRST_GAME"])).length, 0);
  assert.equal(steam.setStats({ games: 1 }).written, 0);
  assert.equal(await steam.getWebApiTicket(), null);
  steam.onMicroTxnAuthorization(() => {})();
  assert.equal(calls.length, 2);
  assert.equal(steam.openOverlay("Friends"), true);
  assert.equal(calls[2][0], "overlay");
});

test("full game retains Steam progress and purchase ticket paths", async () => {
  const { steam, calls } = load(false);
  steam.initSteam();
  steam.unlockAchievement("FIRST_GAME");
  assert.equal(steam.setStats({ games: 1 }).written, 1);
  assert.equal(await steam.getWebApiTicket(), "0102");
  assert.ok(calls.some(([name]) => name === "achievement"));
  assert.ok(calls.some(([name, id]) => name === "init" && id === 5035580));
});

test("preload exposes a frozen demo flag to the renderer", () => {
  const preload = readFileSync(new URL("../../preload.cjs", import.meta.url), "utf8");
  for (const demo of [false, true]) {
    let bridge;
    runInNewContext(preload, {
      process: {
        argv: ["electron", `--tiao-steam-demo=${demo ? 1 : 0}`, "--tiao-steam-build=1"],
        env: {},
        platform: "linux",
      },
      require: () => ({
        contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } },
        ipcRenderer: {},
      }),
    });
    assert.equal(bridge.config.isSteamDemo, demo);
    assert.equal(bridge.config.isSteamBuild, true);
    assert.equal(Object.isFrozen(bridge.config), true);
  }
});
