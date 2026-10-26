// @ts-check
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

/** @param {string} platform @param {boolean} enabled */
function bridge(platform, enabled = true) {
  const calls = /** @type {string[]} */ ([]);
  const module = { exports: /** @type {any} */ ({}) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "steam.cjs"), "utf8"), {
    module, process: { platform, env: {} }, console, Buffer,
    require: /** @param {string} name */ (name) => {
      if (name === "../package.json") return { steamBuild: enabled };
      if (name === "steamworks.js") return {
        init: () => { calls.push("init"); return {}; },
        electronEnableSteamOverlay: () => calls.push("chromium"),
      };
      if (name === "./steamOverlayMac.cjs") return {
        attachMacSteamOverlay: () => { calls.push("metal"); return true; },
      };
      throw new Error(`Unexpected require: ${name}`);
    },
  });
  return { api: module.exports, calls };
}

test("Mac keeps Chromium's GPU separate and attaches Metal only after Steam initializes", () => {
  const { api, calls } = bridge("darwin");
  assert.equal(api.prepareSteamOverlay(), true);
  assert.equal(api.attachSteamOverlay({}), false);
  assert.deepEqual(calls, []);
  api.initSteam();
  assert.equal(api.attachSteamOverlay({}), true);
  assert.deepEqual(calls, ["init", "metal"]);
});

for (const platform of ["win32", "linux"]) {
  test(`${platform} keeps the Chromium overlay hooks and never loads Metal`, () => {
    const { api, calls } = bridge(platform);
    api.prepareSteamOverlay();
    api.initSteam();
    assert.equal(api.attachSteamOverlay({}), false);
    assert.deepEqual(calls, ["chromium", "init"]);
  });
}

test("standalone never loads native overlay code", () => {
  const { api, calls } = bridge("darwin", false);
  assert.equal(api.prepareSteamOverlay(), false);
  assert.equal(api.initSteam(), false);
  assert.equal(api.attachSteamOverlay({}), false);
  assert.deepEqual(calls, []);
});

test("Metal view detaches on close and tolerates unavailable native code", () => {
  const source = fs.readFileSync(path.join(__dirname, "steamOverlayMac.cjs"), "utf8");
  const events = /** @type {string[]} */ ([]);
  let closed = () => {};
  const handle = {};
  const module = { exports: /** @type {any} */ ({}) };
  vm.runInNewContext(source, {
    module, __dirname, console,
    require: /** @param {string} name */ (name) => name === "node:path" ? path : {
      attach: () => { events.push("attach"); return handle; },
      detach: /** @param {unknown} received */ (received) => {
        assert.equal(received, handle); events.push("detach");
      },
    },
  });
  assert.equal(module.exports.attachMacSteamOverlay({
    getNativeWindowHandle: () => Buffer.alloc(8),
    once: /** @param {string} event @param {() => void} callback */ (event, callback) => {
      assert.equal(event, "closed"); closed = callback;
    },
  }), true);
  closed();
  assert.deepEqual(events, ["attach", "detach"]);
  assert.equal(module.exports.attachMacSteamOverlay({
    getNativeWindowHandle: () => { throw new Error("unavailable"); },
  }), false);
});
