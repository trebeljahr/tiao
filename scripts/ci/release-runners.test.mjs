import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Execute the actual publishers against a fake GitHub CLI. No network,
// credentials, stores or real keychains are used by these tests.
const ghStub = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALLS, JSON.stringify(args) + '\\n');
const run = JSON.parse(process.env.SOURCE_RUN);
if (args[0] === 'api') console.log(JSON.stringify(run));
if (args[0] === 'run' && args[1] === 'download') {
  const mobile = process.env.FAMILY === 'mobile';
  const name = args[args.indexOf(mobile ? '--pattern' : '--name') + 1];
  const platform = name.split('-')[1];
  const arch = {macos:'universal',mas:'universal',windows:'x64',linux:'x64',msstore:'x64',ios:'arm64',android:'universal'}[platform];
  let dir = args[args.indexOf('--dir') + 1];
  if (mobile) dir = path.join(dir, 'release-' + platform + '-' + arch);
  fs.mkdirSync(dir, {recursive:true});
  const names = platform === 'ios' ? ['Tiao.ipa'] : platform === 'android' ? ['Tiao.aab','Tiao-mapping.txt'] : ['Tiao.bin'];
  const files = names.map(name => {
    fs.writeFileSync(path.join(dir, name), 'signed fixture');
    return {name, sha256:createHash('sha256').update('signed fixture').digest('hex'), channel:platform === 'mas' ? 'mas' : platform === 'msstore' ? 'msstore' : 'direct'};
  });
  const manifest = {schema:1,repository:'trebeljahr/tiao',commit:run.head_sha,runId:String(run.id),mode:'signed',version:'1.0.0',buildNumber:'42',platform,arch,files};
  fs.writeFileSync(path.join(dir, 'manifest-' + platform + '-' + arch + '.json'), JSON.stringify(manifest));
  if (process.env.TAMPER) fs.writeFileSync(path.join(dir,names[0]), 'tampered fixture');
}
`;

function publish(family, destination, appleRunner, extra = {}) {
  const root = mkdtempSync(join(tmpdir(), "tiao-publisher-"));
  try {
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "gh"), ghStub, { mode: 0o755 });
    const calls = join(root, "calls");
    const sourceRun = {
      id: 123,
      head_repository: { full_name: "trebeljahr/tiao" },
      event: "workflow_dispatch",
      head_branch: "main",
      path: `.github/workflows/build-${family}.yml`,
      conclusion: "success",
      head_sha: "a".repeat(40),
    };
    const script = fileURLToPath(
      new URL(`../../${family}/scripts/release/prepare-publish.mjs`, import.meta.url),
    );
    const result = spawnSync(process.execPath, [script, destination, "123"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: bin + ":" + process.env.PATH,
        GITHUB_EVENT_NAME: "workflow_dispatch",
        GITHUB_REF: "refs/heads/main",
        GITHUB_REPOSITORY: "trebeljahr/tiao",
        GITHUB_OUTPUT: "",
        APPLE_RUNNER: appleRunner,
        SOURCE_RUN: JSON.stringify(sourceRun),
        FAMILY: family,
        CALLS: calls,
        TAMPER: "",
        ...extra,
      },
    });
    return { ...result, calls: readFileSync(calls, "utf8").trim().split("\n").map(JSON.parse) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

for (const label of ["", "hatchkit-mac"]) {
  for (const [family, destination] of [
    ["desktop", "downloads-draft"],
    ["desktop", "mas"],
    ["desktop", "msstore"],
    ["mobile", "ios"],
    ["mobile", "android"],
  ]) {
    test(`${family} ${destination} verifies artifact provenance with local runner ${label || "disabled"}`, () => {
      const result = publish(family, destination, label);
      assert.equal(result.status, 0, result.stderr + result.stdout);
      const attestations = result.calls.filter(([command]) => command === "attestation");
      assert.ok(attestations.length);
      for (const args of attestations) {
        const apple = /manifest-(macos|mas|ios)-/.test(args[2]);
        assert.equal(args.includes("--deny-self-hosted-runners"), !label || !apple);
        for (const [flag, expected] of [
          ["--repo", "trebeljahr/tiao"],
          ["--signer-workflow", `trebeljahr/tiao/.github/workflows/build-${family}.yml`],
          ["--source-ref", "refs/heads/main"],
          ["--source-digest", "a".repeat(40)],
        ])
          assert.equal(args[args.indexOf(flag) + 1], expected);
      }
    });
  }
}

for (const [family, destination] of [
  ["desktop", "mas"],
  ["mobile", "ios"],
]) {
  test(`${family} still rejects modified Apple artifacts with local runner enabled`, () => {
    const result = publish(family, destination, "hatchkit-mac", { TAMPER: "1" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /checksum mismatch/);
    assert.equal(
      result.calls.some(([command]) => command === "attestation"),
      false,
    );
  });
}
