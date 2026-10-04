// electron-builder entry point: `electron-builder --config electron-builder.config.cjs`.
//
// TIAO_DISTRIBUTION_CHANNEL  direct | itch | steam | mas | msstore (default direct)
// TIAO_SIGNED=1              force signing (CI release mode); otherwise unsigned
// See scripts/release/builder-config.cjs and ../docs/RELEASING-desktop.md.
const { build } = require("./package.json");
const { createBuilderConfig } = require("./scripts/release/builder-config.cjs");

module.exports = createBuilderConfig({
  base: build,
  channel: process.env.TIAO_DISTRIBUTION_CHANNEL || "direct",
  signed: process.env.TIAO_SIGNED === "1",
  env: process.env,
});
