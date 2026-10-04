// @ts-check
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  DISTRIBUTION_CHANNELS,
  DISTRIBUTION_CHANNEL,
  resolveDistributionChannel,
  channelAllowsSelfUpdate,
} = require("./distribution.cjs");

test("an unmarked build is a direct download", () => {
  assert.equal(resolveDistributionChannel({ steamBuild: false }), "direct");
  assert.equal(DISTRIBUTION_CHANNELS.includes(DISTRIBUTION_CHANNEL), true);
});

test("the baked channel wins over runtime store flags", () => {
  for (const channel of DISTRIBUTION_CHANNELS) {
    if (channel === "steam") continue;
    assert.equal(resolveDistributionChannel({ bakedChannel: channel, steamBuild: false }), channel);
  }
});

test("a Steam build is always the steam channel", () => {
  assert.equal(resolveDistributionChannel({ bakedChannel: "direct", steamBuild: true }), "steam");
  assert.equal(resolveDistributionChannel({ steamBuild: true }), "steam");
});

test("store runtimes are recognised when metadata is missing or invalid", () => {
  assert.equal(resolveDistributionChannel({ steamBuild: false, mas: true }), "mas");
  assert.equal(resolveDistributionChannel({ steamBuild: false, windowsStore: true }), "msstore");
  assert.equal(resolveDistributionChannel({ bakedChannel: "nope", steamBuild: false, mas: true }), "mas");
});

test("only direct downloads may self-update", () => {
  assert.deepEqual(
    DISTRIBUTION_CHANNELS.filter((channel) => channelAllowsSelfUpdate(channel)),
    ["direct"],
  );
});
