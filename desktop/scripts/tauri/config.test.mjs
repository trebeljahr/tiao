import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertPackagedChannel } from "../release/lib.mjs";
import { buildConfig, metadata } from "./config.mjs";

test("Steam products bake distinct identities and include only their native SDK", () => {
  for (const channel of ["steam", "steam-demo"]) {
    const config = buildConfig({ channel, platform: "macos", env: {} });
    assert.equal(
      config.identifier,
      "com.ricoslabs.tiao" + (channel === "steam-demo" ? ".demo" : ""),
    );
    assert.deepEqual(config.bundle.macOS.frameworks, [".generated-sdk/libsteam_api.dylib"]);
    assert.equal(
      metadata(channel, "1.0.0").steamAppId,
      channel === "steam-demo" ? 5491870 : 5035580,
    );
  }
  assert.throws(() =>
    buildConfig({ channel: "steam-demo", platform: "macos", env: { TIAO_STEAM_APPID: "5035580" } }),
  );
});
test("stores never include Steam libraries or a self-updater", () => {
  for (const [channel, platform] of [
    ["mas", "mas"],
    ["msstore", "msstore"],
    ["itch", "windows"],
  ]) {
    const config = buildConfig({ channel, platform, env: {} });
    assert.equal(config.bundle.macOS.frameworks, undefined);
    assert.equal(config.plugins, undefined);
    assert.throws(() => buildConfig({ channel, platform, env: { TIAO_ENABLE_UPDATER: "1" } }));
  }
});
test("direct updater requires an HTTPS feed and Tauri key", () => {
  assert.throws(() => buildConfig({ platform: "macos", env: { TIAO_ENABLE_UPDATER: "1" } }));
  const c = buildConfig({
    platform: "macos",
    env: {
      TIAO_ENABLE_UPDATER: "1",
      TIAO_UPDATER_PUBLIC_KEY: "test",
      TIAO_UPDATER_ENDPOINT: "https://example.com/update",
    },
  });
  assert.equal(c.bundle.createUpdaterArtifacts, true);
});
test("packaged metadata rejects mismatched runtime, channel and AppID", () => {
  const directory = mkdtempSync(join(tmpdir(), "tiao-metadata-"));
  try {
    const path = join(directory, "tiao-build.json");
    for (const channel of ["direct", "steam", "steam-demo", "mas", "msstore"]) {
      const meta = metadata(channel, "1.0.0");
      writeFileSync(path, JSON.stringify(meta));
      assertPackagedChannel(path, channel);
      assert.throws(() => assertPackagedChannel(path, channel === "direct" ? "itch" : "direct"));
      writeFileSync(path, JSON.stringify({ ...meta, runtime: "electron" }));
      assert.throws(() => assertPackagedChannel(path, channel));
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
