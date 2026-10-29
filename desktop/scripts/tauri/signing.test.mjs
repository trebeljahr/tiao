import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import test from "node:test";
import { appleSigning } from "./signing.mjs";

const env = {
  TIAO_SIGNED: "1",
  CSC_LINK: Buffer.from("fake certificate").toString("base64"),
  CSC_KEY_PASSWORD: "fake certificate password",
};
function fake(fail = false) {
  const calls = [];
  return {
    calls,
    run: (...args) => {
      calls.push(args);
      if (args[0] === "list-keychains" && args.length === 3)
        return '"/Users/test/login.keychain-db"\n"/Library/Keychains/System.keychain"';
      if (fail && args[0] === "import") throw Error("fake import failure");
      return "";
    },
  };
}
test("unsigned Apple builds never touch credential tools", () => {
  appleSigning({ ...env, TIAO_SIGNED: "0" }, false, {
    platform: "darwin",
    run() {
      throw Error("must not access a keychain");
    },
  }).close();
});
test("signing restores the original search list and deletes its temporary material", () => {
  const fakeTools = fake();
  const signing = appleSigning(env, false, { platform: "darwin", run: fakeTools.run });
  assert.equal(signing.env.APPLE_CERTIFICATE, undefined);
  const keychain = signing.env.APPLE_KEYCHAIN;
  assert.ok(existsSync(dirname(keychain)));
  const create = fakeTools.calls.find((c) => c[0] === "create-keychain");
  const partition = fakeTools.calls.find((c) => c[0] === "set-key-partition-list");
  assert.equal(create[2], partition[partition.indexOf("-k") + 1]);
  signing.close();
  assert.equal(existsSync(dirname(keychain)), false);
  assert.deepEqual(fakeTools.calls.at(-2), [
    "list-keychains",
    "-d",
    "user",
    "-s",
    "/Users/test/login.keychain-db",
    "/Library/Keychains/System.keychain",
  ]);
  assert.deepEqual(fakeTools.calls.at(-1), ["delete-keychain", keychain]);
});
test("failed certificate import still cleans up and never exposes passwords", () => {
  const fakeTools = fake(true);
  assert.throws(
    () => appleSigning(env, false, { platform: "darwin", run: fakeTools.run }),
    (e) => !e.message.includes(env.CSC_KEY_PASSWORD),
  );
  assert.equal(fakeTools.calls.at(-1)[0], "delete-keychain");
  assert.equal(existsSync(dirname(fakeTools.calls.at(-1)[1])), false);
});
