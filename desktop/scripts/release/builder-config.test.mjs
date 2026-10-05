import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createBuilderConfig } = require("./builder-config.cjs");
const { build: base } = require("../../package.json");
const storeIdentity = {
  WINDOWS_STORE_IDENTITY_NAME: "RicosLabsLLC.Tiao",
  WINDOWS_STORE_PUBLISHER: "CN=11111111-2222-3333-4444-555555555555",
  WINDOWS_STORE_PUBLISHER_DISPLAY_NAME: "Ricos Labs LLC",
};
const config = (channel, signed = false, env = {}) =>
  createBuilderConfig({ base, channel, signed, env });

test("the base config carries Tiao identity, icons and store metadata", () => {
  assert.equal(base.appId, "com.ricoslabs.tiao");
  assert.equal(base.copyright, "Copyright © 2026 Ricos Labs LLC");
  assert.equal(base.directories.buildResources, "build");
  assert.equal(base.mac.icon, "build/icon.icns");
  assert.equal(base.win.icon, "build/icon.ico");
  assert.equal(base.linux.icon, "build/icon.png");
  assert.equal(base.mac.category, "public.app-category.board-games");
  assert.equal(base.mac.extendInfo.ITSAppUsesNonExemptEncryption, false);
  assert.equal(base.mac.extendInfo.ElectronTeamID, "4BHY8H2J25");
  assert.deepEqual(base.protocols[0].schemes, ["tiao"]);
  assert.equal(base.files.includes("steam_appid.txt"), false, "steam_appid.txt is dev-only");
  assert.deepEqual(base.appx.languages, ["en-US", "de-DE", "es-ES"]);
});

test("every channel bakes its name and writes to its own output directory", () => {
  for (const channel of ["direct", "itch", "steam", "mas", "msstore"]) {
    const c = config(channel);
    assert.equal(c.extraMetadata.distributionChannel, channel);
    assert.equal(c.directories.output, "dist/" + channel);
    assert.equal(c.extraMetadata.steamBuild === true, channel === "steam");
    assert.equal(c.publish === null, channel !== "direct", "only direct carries an update feed");
  }
  assert.throws(() => config("appstore"));
});

test("Steam builds bake the real appid and refuse Spacewar", () => {
  assert.equal(config("steam").extraMetadata.steamAppId, 5035580);
  assert.throws(() => config("steam", false, { TIAO_STEAM_APPID: "480" }), /Spacewar/);
  assert.deepEqual(config("steam").win.target, [{ target: "dir", arch: ["x64"] }]);
  assert.deepEqual(config("steam").mac.target, [{ target: "dir", arch: ["universal"] }]);
});

test("store builds drop steamworks.js; desktop channels keep it unpacked", () => {
  for (const channel of ["mas", "msstore"]) {
    const c = config(channel);
    assert.ok(c.files.includes("!node_modules/steamworks.js/**"));
    assert.equal(
      c.asarUnpack.some((p) => p.includes("steamworks")),
      false,
    );
  }
  assert.ok(config("steam").asarUnpack.some((p) => p.includes("steamworks")));
});

test("signed desktop builds force signing; unsigned Mac builds skip identity and hardened runtime", () => {
  const signed = config("direct", true);
  assert.equal(signed.forceCodeSigning, true);
  assert.equal(signed.mac.hardenedRuntime, true);
  assert.equal(signed.win.signtoolOptions.sign, "./scripts/sign-windows.cjs");
  assert.equal(signed.win.signtoolOptions.publisherName, "Ricos Labs LLC");
  assert.deepEqual(signed.win.signtoolOptions.signingHashAlgorithms, ["sha256"]);
  const smoke = config("direct");
  assert.equal(smoke.forceCodeSigning, undefined);
  assert.equal(smoke.mac.identity, null);
  assert.equal(smoke.mac.hardenedRuntime, false);
  assert.equal(smoke.win.signtoolOptions.sign, undefined);
});

test("Mac App Store build is universal, sandboxed and needs its provisioning profile", () => {
  assert.throws(() => config("mas", true), /MAS_PROVISIONING_PROFILE/);
  const mas = config("mas", true, { MAS_PROVISIONING_PROFILE: "/tmp/tiao.provisionprofile" });
  assert.deepEqual(mas.mac.target, [{ target: "mas", arch: ["universal"] }]);
  assert.equal(mas.mas.provisioningProfile, "/tmp/tiao.provisionprofile");
  assert.equal(mas.mas.type, "distribution");
  assert.equal(mas.mas.hardenedRuntime, false);
  assert.equal(mas.mas.entitlements, "build/entitlements.mas.plist");
  assert.equal(mas.mas.entitlementsInherit, "build/entitlements.mas.inherit.plist");
  assert.equal(mas.forceCodeSigning, true);
  assert.equal(config("mas").mas.identity, null);
});

test("Microsoft Store AppX is unsigned and requires the Partner Center identity when releasing", () => {
  assert.throws(() => config("msstore", true), /WINDOWS_STORE_IDENTITY_NAME/);
  const store = config("msstore", true, storeIdentity);
  assert.deepEqual(store.win.target, [{ target: "appx", arch: ["x64"] }]);
  assert.equal(store.appx.identityName, "RicosLabsLLC.Tiao");
  assert.equal(store.appx.publisher, storeIdentity.WINDOWS_STORE_PUBLISHER);
  assert.equal(store.appx.applicationId, "Tiao");
  assert.equal(store.forceCodeSigning, undefined);
  assert.equal(store.win.signtoolOptions.sign, undefined);
  assert.match(config("msstore").appx.publisher, /^CN=/);
});
