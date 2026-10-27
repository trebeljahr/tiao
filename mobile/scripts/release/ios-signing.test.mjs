import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("ios-signing.sh", import.meta.url));
const securityStub = `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const root = process.env.SIGNING_FIXTURE;
fs.appendFileSync(root + '/calls', JSON.stringify(args) + '\\n');
const [command] = args;
if (command === 'cms') process.stdout.write(fs.readFileSync(root + '/profile.plist'));
if (command === 'create-keychain') fs.writeFileSync(args.at(-1), 'temporary keychain');
if (command === 'delete-keychain') fs.unlinkSync(args.at(-1));
if (command === 'find-identity') console.log(' 1) ' + (process.env.SIGNING_FAIL === 'identity' ? 'BAD' : 'A9993E364706816ABA3E25717850C26C9CD0D89D') + ' "Apple Distribution: Fixture"');
if (command === 'import' && process.env.SIGNING_FAIL === 'import') process.exit(1);
if (command === 'list-keychains') {
  const list = root + '/keychains.json';
  if (args.includes('-s')) fs.writeFileSync(list, JSON.stringify(args.slice(args.indexOf('-s') + 1)));
  else for (const path of JSON.parse(fs.readFileSync(list))) console.log('    ' + JSON.stringify(path));
}
`;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "tiao-ios-signing-"));
  const home = join(root, "operator");
  const bin = join(root, "bin");
  const runner = join(root, "runner");
  const profiles = join(home, "Library/MobileDevice/Provisioning Profiles");
  for (const path of [bin, runner, profiles]) mkdirSync(path, { recursive: true });
  writeFileSync(join(bin, "security"), securityStub, { mode: 0o755 });
  writeFileSync(join(profiles, "tiao-release.mobileprovision"), "operator's existing profile");
  const keychains = [
    join(home, "Library/Keychains/login.keychain-db"),
    "/path with spaces/custom.keychain-db",
  ];
  writeFileSync(join(root, "keychains.json"), JSON.stringify(keychains));
  const profile = spawnSync("python3", [
    "-c",
    `
import datetime, plistlib, sys
plistlib.dump({
    'TeamIdentifier': ['4BHY8H2J25'],
    'Entitlements': {'application-identifier': '4BHY8H2J25.com.ricoslabs.tiao', 'beta-reports-active': True},
    'ExpirationDate': datetime.datetime(2099, 1, 1),
    'Name': 'Tiao Fixture', 'DeveloperCertificates': [b'abc']
}, sys.stdout.buffer)
`,
  ]);
  assert.equal(profile.status, 0, String(profile.stderr));
  writeFileSync(join(root, "profile.plist"), profile.stdout);
  const env = {
    ...process.env,
    PATH: bin + ":" + process.env.PATH,
    HOME: home,
    RUNNER_TEMP: runner,
    GITHUB_ENV: join(root, "github-env"),
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: "trebeljahr/tiao",
    RUNNER_ENVIRONMENT: "self-hosted",
    APPLE_CERTIFICATE_BASE64: Buffer.from("fake p12").toString("base64"),
    APPLE_CERTIFICATE_PASSWORD: "fake password",
    APPLE_PROVISIONING_PROFILE_BASE64: Buffer.from("fake signed profile").toString("base64"),
    SIGNING_FIXTURE: root,
    SIGNING_FAIL: "",
  };
  return {
    root,
    profiles,
    runner,
    keychains,
    env,
    run(args = [], extra = {}) {
      return spawnSync("bash", [script, ...args], { env: { ...env, ...extra }, encoding: "utf8" });
    },
    dispose() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

for (const runner of ["self-hosted", "github-hosted"]) {
  test(`${runner} signing preserves operator profiles and keychains through cleanup`, () => {
    const f = fixture();
    try {
      const result = f.run([], { RUNNER_ENVIRONMENT: runner });
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.equal(readdirSync(f.profiles).length, 2);
      const during = JSON.parse(readFileSync(join(f.root, "keychains.json")));
      assert.deepEqual(during.slice(1), f.keychains);
      // An unrelated keychain added while building must survive cleanup too.
      during.push("/another/job.keychain-db");
      writeFileSync(join(f.root, "keychains.json"), JSON.stringify(during));
      assert.equal(f.run(["cleanup"], { RUNNER_ENVIRONMENT: runner }).status, 0);
      assert.deepEqual(JSON.parse(readFileSync(join(f.root, "keychains.json"))), [
        ...f.keychains,
        "/another/job.keychain-db",
      ]);
      assert.deepEqual(readdirSync(f.profiles), ["tiao-release.mobileprovision"]);
      assert.equal(
        readFileSync(join(f.profiles, "tiao-release.mobileprovision"), "utf8"),
        "operator's existing profile",
      );
      assert.deepEqual(readdirSync(f.runner), []);
      assert.equal(f.run(["cleanup"]).status, 0, "cleanup is idempotent");
    } finally {
      f.dispose();
    }
  });
}

for (const stage of ["import", "identity"]) {
  test(`failed ${stage} removes temporary material without waiting for a later workflow step`, () => {
    const f = fixture();
    try {
      assert.notEqual(f.run([], { SIGNING_FAIL: stage }).status, 0);
      assert.deepEqual(readdirSync(f.runner), []);
      assert.deepEqual(readdirSync(f.profiles), ["tiao-release.mobileprovision"]);
      assert.deepEqual(JSON.parse(readFileSync(join(f.root, "keychains.json"))), f.keychains);
    } finally {
      f.dispose();
    }
  });
}

test("fork, PR, feature branch and non-CI signing fail before any keychain command", () => {
  const f = fixture();
  try {
    for (const extra of [
      { GITHUB_EVENT_NAME: "pull_request" },
      { GITHUB_REF: "refs/heads/feature" },
      { GITHUB_REPOSITORY: "fork/tiao" },
      { GITHUB_ACTIONS: "false" },
    ]) {
      assert.notEqual(f.run([], extra).status, 0);
      assert.deepEqual(readdirSync(f.runner), []);
    }
    assert.throws(() => readFileSync(join(f.root, "calls")), /ENOENT/);
  } finally {
    f.dispose();
  }
});
