import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildNumber,
  repository,
  requireCredentials,
  requireMain,
  sha256,
  validateManifest,
  validateRun,
  version,
} from "./lib.mjs";

const run = {
  id: 123,
  head_repository: { full_name: repository },
  event: "workflow_dispatch",
  head_branch: "main",
  path: ".github/workflows/build-mobile.yml",
  conclusion: "success",
  head_sha: "a".repeat(40),
};

test("release signing accepts only the canonical main dispatch, including no tag or fork trust", () => {
  const env = {
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: repository,
  };
  assert.doesNotThrow(() => requireMain(env));
  for (const mutation of [
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_REF: "refs/tags/v1.2.3" },
    { GITHUB_REF: "refs/heads/mobile-signing" },
    { GITHUB_REPOSITORY: "another/tiao" },
  ]) {
    assert.throws(() => requireMain({ ...env, ...mutation }));
  }
});

test("a green unrelated workflow, fork, PR, failed run or mismatched run cannot be published", () => {
  validateRun(run, "123");
  for (const mutation of [
    { head_repository: { full_name: "fork/tiao" } },
    { event: "pull_request" },
    { head_branch: "feature" },
    { path: ".github/workflows/build-and-deploy.yml" },
    { conclusion: "failure" },
    { id: 456 },
    { head_sha: "not-a-sha" },
  ]) {
    assert.throws(() => validateRun({ ...run, ...mutation }, "123"));
  }
  assert.throws(() => validateRun(run, "0123"));
});

test("partial signing sets fail with names only", () => {
  assert.throws(
    () => requireCredentials("android", { ANDROID_KEYSTORE_BASE64: "sensitive-keystore" }),
    (error) =>
      error.message.includes("ANDROID_KEY_PASSWORD") &&
      !error.message.includes("sensitive-keystore"),
  );
  // An unset secret arrives as "" or whitespace; it must count as missing.
  assert.throws(() => requireCredentials("play", { PLAY_SERVICE_ACCOUNT_JSON: "  " }));
  assert.throws(() => requireCredentials("ios", {}));
  assert.throws(() => requireCredentials("steam", {}), /Unknown credential target/);
  assert.doesNotThrow(() =>
    requireCredentials("testflight", {
      APPLE_API_KEY_BASE64: "k",
      APPLE_API_KEY_ID: "i",
      APPLE_API_ISSUER_ID: "s",
    }),
  );
});

test("mobile versions and build numbers cannot silently reset or accept unsafe input", () => {
  assert.equal(version("1.2.3"), "1.2.3");
  assert.equal(buildNumber("501"), "501");
  for (const invalid of ["", "0", "-1", "1.1", "1e3", "01", "2100000001", "12\nBAD=value"]) {
    assert.throws(() => buildNumber(invalid));
  }
  for (const invalid of ["1.2", "1.2.3-rc.1", "v1.2.3", "01.2.3"])
    assert.throws(() => version(invalid));
});

test("artifact integrity rejects modified, unsigned, wrong-commit and unsafe payloads", () => {
  const directory = mkdtempSync(join(tmpdir(), "tiao-release-test-"));
  try {
    const path = join(directory, "Tiao.aab");
    writeFileSync(path, "signed bundle stand-in");
    const manifest = {
      schema: 1,
      repository,
      commit: run.head_sha,
      runId: "123",
      mode: "signed",
      version: "1.2.3",
      buildNumber: "7",
      platform: "android",
      arch: "universal",
      files: [{ name: "Tiao.aab", sha256: sha256(path) }],
    };
    assert.equal(validateManifest(manifest, run, directory), "android-universal");
    assert.throws(() => validateManifest({ ...manifest, mode: "smoke" }, run, directory));
    assert.throws(() => validateManifest({ ...manifest, commit: "b".repeat(40) }, run, directory));
    assert.throws(() => validateManifest({ ...manifest, buildNumber: null }, run, directory));
    assert.throws(() =>
      validateManifest({ ...manifest, platform: "windows", arch: "x64" }, run, directory),
    );
    assert.throws(() =>
      validateManifest(
        { ...manifest, files: [...manifest.files, ...manifest.files] },
        run,
        directory,
      ),
    );
    for (const name of ["../Tiao.aab", "..\\Tiao.aab", "Tiao.aab\ninjected", "-option.aab"]) {
      assert.throws(() =>
        validateManifest({ ...manifest, files: [{ ...manifest.files[0], name }] }, run, directory),
      );
    }
    symlinkSync(path, join(directory, "link.aab"));
    assert.throws(() =>
      validateManifest(
        { ...manifest, files: [{ ...manifest.files[0], name: "link.aab" }] },
        run,
        directory,
      ),
    );
    writeFileSync(path, "tampered bundle");
    assert.throws(() => validateManifest(manifest, run, directory), /checksum mismatch/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
