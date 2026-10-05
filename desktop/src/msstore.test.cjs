// @ts-check
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const { createMsStoreBridge } = require("./msstore.cjs");

/** @returns {import("./msstore.cjs").MsStoreAddon & { calls: string[] }} */
function fakeAddon() {
  /** @type {string[]} */
  const calls = [];
  return {
    calls,
    async getAddOns() {
      calls.push("getAddOns");
      return [
        {
          storeId: "9NBLGGH4R1A1",
          inAppOfferToken: "tiao.badge.supporter",
          title: "Supporter Badge",
          formattedPrice: "$2.99",
          isInUserCollection: false,
        },
      ];
    },
    async requestPurchase(storeId, hwnd) {
      calls.push(`requestPurchase:${storeId}:${hwnd.length}`);
      return { status: "succeeded", extendedError: "" };
    },
    async getCustomerCollectionsId(ticket, userId) {
      calls.push(`collections:${ticket}:${userId}`);
      return "eyJ.key.sig";
    },
  };
}

describe("msstore bridge gating", () => {
  test("never loads the addon outside an msstore build on Windows", () => {
    let loads = 0;
    const load = () => {
      loads++;
      return fakeAddon();
    };
    for (const [channel, platform] of [
      ["direct", "win32"],
      ["steam", "win32"],
      ["msstore", "darwin"],
    ]) {
      assert.equal(createMsStoreBridge({ channel, platform, load }).isAvailable(), false);
    }
    assert.equal(loads, 0);
  });

  test("degrades to unavailable when the addon fails to load", async () => {
    const bridge = createMsStoreBridge({
      channel: "msstore",
      platform: "win32",
      load: () => {
        throw new Error("The specified module could not be found.");
      },
    });
    assert.equal(bridge.isAvailable(), false);
    assert.deepEqual(await bridge.purchase("tiao.badge.supporter", Buffer.alloc(8)), {
      status: "unavailable",
    });
    assert.equal(await bridge.getCollectionsId("ticket", "player"), null);
    assert.deepEqual(await bridge.getAddOns(), []);
  });
});

describe("msstore purchase", () => {
  test("resolves the offer token to the Partner Center Store ID", async () => {
    const addon = fakeAddon();
    const bridge = createMsStoreBridge({
      channel: "msstore",
      platform: "win32",
      load: () => addon,
    });
    const res = await bridge.purchase("tiao.badge.supporter", Buffer.alloc(8));
    assert.equal(res.status, "succeeded");
    assert.deepEqual(addon.calls, ["getAddOns", "requestPurchase:9NBLGGH4R1A1:8"]);
  });

  test("an offer token Partner Center does not know is refused before the dialog", async () => {
    const addon = fakeAddon();
    const bridge = createMsStoreBridge({
      channel: "msstore",
      platform: "win32",
      load: () => addon,
    });
    const res = await bridge.purchase("tiao.theme.unknown", Buffer.alloc(8));
    assert.equal(res.status, "unknownProduct");
    assert.ok(!addon.calls.some((c) => c.startsWith("requestPurchase")));
  });

  test("passes the service ticket and player id to GetCustomerCollectionsIdAsync", async () => {
    const addon = fakeAddon();
    const bridge = createMsStoreBridge({
      channel: "msstore",
      platform: "win32",
      load: () => addon,
    });
    assert.equal(await bridge.getCollectionsId("aad-token", "64b0"), "eyJ.key.sig");
    assert.deepEqual(addon.calls, ["collections:aad-token:64b0"]);
  });
});
