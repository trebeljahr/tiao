import assert from "node:assert/strict";
import test from "node:test";
import { createNotarizer, notaryCredentials } from "./notarize.mjs";

test("notarization uses Tauri API credentials or an existing local profile", () => {
  assert.deepEqual(notaryCredentials({ APPLE_KEYCHAIN_PROFILE: "local-notary" }), [
    "--keychain-profile",
    "local-notary",
  ]);
  assert.deepEqual(
    notaryCredentials({
      APPLE_API_KEY_PATH: "/fake/key.p8",
      APPLE_API_KEY: "fake-id",
      APPLE_API_ISSUER: "fake-issuer",
    }),
    ["--key", "/fake/key.p8", "--key-id", "fake-id", "--issuer", "fake-issuer"],
  );
  assert.throws(() => notaryCredentials({}));
});
test("an exit-zero rejected submission fails without stapling", async () => {
  const calls = [];
  const notarize = createNotarizer({
    env: { APPLE_KEYCHAIN_PROFILE: "fake" },
    run: (_command, args) => {
      calls.push(args);
      return '{"status":"Invalid"}';
    },
    wait: async () => {},
  });
  await assert.rejects(notarize("/fake/package.dmg"), /rejected/);
  assert.equal(calls.length, 1);
});
test("signed app ticket is validated before archives are built and transient stapling retries", async () => {
  let failures = 2;
  const calls = [];
  const notarize = createNotarizer({
    env: {},
    run: (_command, args) => {
      calls.push(args);
      if (args[1] === "validate" && failures > 0) throw Error("missing ticket");
      if (args[1] === "staple" && failures-- > 0) throw Error("temporary service error");
      return "";
    },
    wait: async () => {},
  });
  await notarize("/fake/Tiao.app", { app: true });
  assert.equal(calls.at(-1)[1], "validate");
  assert.equal(
    calls.some((args) => args[0] === "notarytool"),
    false,
  );
});
