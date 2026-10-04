import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./collect.mjs", import.meta.url));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "tiao-collect-"));
  writeFileSync(join(root, "package.json"), '{"version":"1.2.3"}');
  const outputs = join(root, "android/app/build/outputs");
  for (const dir of ["bundle/release", "apk/release", "mapping/release"])
    mkdirSync(join(outputs, dir), { recursive: true });
  writeFileSync(join(outputs, "bundle/release/app-release.aab"), "test bundle");
  writeFileSync(join(outputs, "apk/release/app-release.apk"), "test apk");
  writeFileSync(join(outputs, "mapping/release/mapping.txt"), "test mapping");
  return root;
}

const collect = (cwd, build = "42") =>
  execFileSync(process.execPath, [script, "android", "universal", "signed"], {
    cwd,
    env: {
      ...process.env,
      GITHUB_SHA: "a".repeat(40),
      GITHUB_RUN_ID: "123",
      RELEASE_BUILD_NUMBER: build,
    },
    stdio: "pipe",
  });

test("Android collection stages AAB, APK and R8 mapping with a matching manifest and never stale files", () => {
  const root = fixture();
  try {
    collect(root);
    const output = join(root, "release/upload");
    writeFileSync(join(output, "stale-secret.txt"), "must not be uploaded");
    collect(root);
    const names = readdirSync(output);
    assert.equal(names.includes("stale-secret.txt"), false);
    const manifest = JSON.parse(readFileSync(join(output, "manifest-android-universal.json")));
    assert.equal(manifest.mode, "signed");
    assert.equal(manifest.buildNumber, "42");
    assert.equal(manifest.signature, "store-distribution");
    assert.deepEqual(
      manifest.files.map((f) => f.name),
      [
        "Tiao-1.2.3-android-42-mapping.txt",
        "Tiao-1.2.3-android-42.aab",
        "Tiao-1.2.3-android-42.apk",
      ],
    );
    const sums = readFileSync(join(output, "SHA256SUMS-android-universal.txt"), "utf8");
    for (const file of manifest.files)
      assert.match(sums, new RegExp(`^${file.sha256}  ${file.name}$`, "m"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("collection refuses a missing or unsafe build number", () => {
  const root = fixture();
  try {
    for (const build of ["", "0", "1\nX=y"]) assert.throws(() => collect(root, build));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
