import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const expected = "864555f314d7845a10ad45b2a821064b1f96b7e2d4e6b22d9e58af6811a98d23";
const different = "a".repeat(64);
const script = fileURLToPath(new URL("./verify-android.sh", import.meta.url));
function verify(output, { aab = expected, jar = "jar verified." } = {}) {
  const root = mkdtempSync(join(tmpdir(), "tiao-android-verify-"));
  try {
    const bin = join(root, "bin");
    const sdk = join(root, "sdk");
    mkdirSync(bin);
    mkdirSync(join(sdk, "build-tools", "37.0.0"), { recursive: true });
    const executable = (path, body) =>
      writeFileSync(path, "#!/usr/bin/env bash\n" + body + "\n", { mode: 0o755 });
    executable(join(bin, "jarsigner"), 'printf "%s\\n" "$FAKE_JAR_RESULT"');
    executable(
      join(bin, "keytool"),
      'if [[ " $* " == *" -jarfile "* ]]; then printf "SHA256: %s\\n" "$FAKE_AAB_DIGEST"; else printf "SHA256: %s\\n" "$FAKE_KEY_DIGEST"; fi',
    );
    executable(
      join(sdk, "build-tools", "37.0.0", "apksigner"),
      'printf "%s\\n" "$FAKE_APK_OUTPUT"',
    );
    return spawnSync("bash", [script], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: bin + ":" + process.env.PATH,
        ANDROID_HOME: sdk,
        ANDROID_KEYSTORE_PATH: join(root, "fake.keystore"),
        ANDROID_KEY_ALIAS: "test",
        ANDROID_KEYSTORE_PASSWORD: "fake-password",
        FAKE_APK_OUTPUT: output,
        FAKE_KEY_DIGEST: expected,
        FAKE_AAB_DIGEST: aab,
        FAKE_JAR_RESULT: jar,
      },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("Android verification accepts old and new SDK certificate labels", () => {
  for (const label of ["Signer #1", "V2 Signer:"]) {
    const result = verify(label + " certificate SHA-256 digest: " + expected);
    assert.equal(result.status, 0, result.stderr);
  }
});
test("Android verification accepts matching digest repeated across signature schemes", () => {
  assert.equal(
    verify(
      ["V2", "V3"].map((v) => v + " Signer: certificate SHA-256 digest: " + expected).join("\n"),
    ).status,
    0,
  );
});
test("Android verification rejects missing or foreign APK signer digests", () => {
  for (const output of [
    "",
    "V2 Signer: certificate SHA-256 digest: " + different,
    "V2 Signer: certificate SHA-256 digest: " +
      expected +
      "\nV3 Signer: certificate SHA-256 digest: " +
      different,
  ]) {
    assert.notEqual(verify(output).status, 0);
  }
});
test("Android verification still rejects a foreign AAB key or unsigned entries", () => {
  const output = "V2 Signer: certificate SHA-256 digest: " + expected;
  for (const options of [
    { aab: different },
    { jar: "jar is unsigned." },
    { jar: "jar verified.\nThis jar contains unsigned entries." },
  ]) {
    assert.notEqual(verify(output, options).status, 0);
  }
});
