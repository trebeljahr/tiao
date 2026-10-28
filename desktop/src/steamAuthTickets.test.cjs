// @ts-check
const assert = require("node:assert/strict");
const { test } = require("node:test");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

test("the demo can authenticate without enabling purchase tickets", async () => {
  let cancelled = false;
  const identities = /** @type {string[]} */ ([]);
  const module = { exports: /** @type {any} */ ({}) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "steam.cjs"), "utf8"), {
    module,
    process: { env: {} },
    Buffer,
    console,
    require: /** @param {string} name */ (name) => {
      if (name === "../package.json")
        return { steamBuild: true, steamDemo: true, steamAppId: 5491870 };
      if (name === "steamworks.js")
        return {
          init: () => ({
            auth: {
              getAuthTicketForWebApi: /** @param {string} identity */ async (identity) => {
                identities.push(identity);
                return {
                  getBytes: () => Buffer.from([0xaa, 0xbb]),
                  cancel: () => {
                    cancelled = true;
                  },
                };
              },
            },
          }),
        };
      throw new Error(`Unexpected require: ${name}`);
    },
  });
  assert.equal(module.exports.initSteam(), true);
  assert.equal(await module.exports.getWebApiTicket(), null);
  const authTicket = await module.exports.getAuthWebApiTicket();
  assert.equal(authTicket.ticket, "aabb");
  assert.equal(cancelled, false);
  authTicket.cancel();
  assert.equal(cancelled, true);
  assert.deepEqual(identities, ["tiao-auth"]);
});

test("sign-in recovers when Steam becomes available after startup", async () => {
  let attempts = 0;
  let cancellations = 0;
  let requests = 0;
  const module = { exports: /** @type {any} */ ({}) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "steam.cjs"), "utf8"), {
    module,
    process: { env: {} },
    Buffer,
    console: { info() {}, warn() {} },
    require: /** @param {string} name */ (name) => {
      if (name === "../package.json") return { steamBuild: true, steamAppId: 5035580 };
      if (name === "steamworks.js")
        return {
          init: /** @param {number} appId */ (appId) => {
            assert.equal(appId, 5035580);
            if (++attempts === 1) throw new Error("Steam is not running yet.");
            return {
              auth: {
                getAuthTicketForWebApi: /** @param {string} identity */ async (identity) => {
                  assert.equal(identity, "tiao-auth");
                  requests++;
                  return {
                    getBytes: () => Buffer.from([0xaa, 0xbb]),
                    cancel: () => cancellations++,
                  };
                },
              },
            };
          },
        };
      throw new Error(`Unexpected require: ${name}`);
    },
  });
  assert.equal(module.exports.initSteam(), false);
  assert.equal(module.exports.isSteamActive(), false);
  const ticket = await module.exports.getAuthWebApiTicket();
  assert.equal(ticket.ticket, "aabb");
  assert.equal(module.exports.isSteamActive(), true);
  assert.equal(cancellations, 0);
  ticket.cancel();
  assert.equal(cancellations, 1);
  await module.exports.getAuthWebApiTicket();
  assert.equal(attempts, 2, "an active client is reused without another initialization");
  assert.equal(requests, 2);
});
