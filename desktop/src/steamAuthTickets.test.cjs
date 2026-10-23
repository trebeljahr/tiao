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
