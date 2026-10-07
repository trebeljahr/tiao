import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./verify-mas.sh", import.meta.url));
const { prepareMasApp } = createRequire(import.meta.url)("./after-pack.cjs");

const details = [
  "Identifier=com.ricoslabs.tiao",
  "Authority=Apple Distribution: Ricos Labs LLC (4BHY8H2J25)",
  "TeamIdentifier=4BHY8H2J25",
].join("\n");
const entitlements = [
  "com.apple.security.app-sandbox",
  "com.apple.security.network.client",
  "4BHY8H2J25.com.ricoslabs.tiao",
  "com.apple.application-identifier",
].join("\n");

const mode = (path) => statSync(path).mode & 0o777;

// A signed-looking dist/mas/mas-universal with codesign, lipo and pkgutil stubbed.
function fixture(root) {
  const bin = join(root, "bin");
  const dir = join(root, "dist/mas/mas-universal");
  const app = join(dir, "Tiao.app");
  mkdirSync(bin);
  mkdirSync(join(app, "Contents/MacOS"), { recursive: true });
  mkdirSync(join(app, "Contents/Resources/app.asar.unpacked"), { recursive: true });
  writeFileSync(join(app, "Contents/MacOS/Tiao"), "", { mode: 0o755 });
  writeFileSync(join(app, "Contents/Resources/app.asar"), "", { mode: 0o644 });
  writeFileSync(join(app, "Contents/embedded.provisionprofile"), "profile", { mode: 0o644 });
  symlinkSync("MacOS/Tiao", join(app, "Contents/Current"));
  writeFileSync(join(dir, "Tiao-0.1.0-mas-universal.pkg"), "");
  const executable = (name, body) =>
    writeFileSync(join(bin, name), "#!/usr/bin/env bash\n" + body, { mode: 0o755 });
  executable(
    "codesign",
    `case "$*" in
  *--verify*) exit 0 ;;
  *--entitlements*) printf '%s\\n' "$FAKE_ENTITLEMENTS" ;;
  *) printf '%s\\n' "$FAKE_DETAILS" >&2 ;;
esac
`,
  );
  executable("lipo", "echo 'x86_64 arm64'\n");
  executable(
    "pkgutil",
    "echo 'Status: signed by a certificate trusted by macOS'\necho '1. 3rd Party Mac Developer Installer: Ricos Labs LLC (4BHY8H2J25)'\n",
  );
  return { bin, app };
}

function verify(root, bin) {
  const result = spawnSync("bash", [script], {
    cwd: root,
    encoding: "utf8",
    timeout: 15000,
    env: {
      ...process.env,
      PATH: bin + ":" + process.env.PATH,
      FAKE_DETAILS: details,
      FAKE_ENTITLEMENTS: entitlements,
    },
  });
  assert.ifError(result.error);
  return result;
}

function withFixture(fn) {
  const root = mkdtempSync(join(tmpdir(), "tiao-verify-mas-test-"));
  try {
    fn(root, fixture(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("a world-readable MAS app passes", () => {
  withFixture((root, { bin }) => {
    const result = verify(root, bin);
    assert.equal(result.status, 0, result.stderr);
  });
});

test("a profile only its owner can read fails, as App Store Connect does", () => {
  withFixture((root, { bin, app }) => {
    chmodSync(join(app, "Contents/embedded.provisionprofile"), 0o600);
    const result = verify(root, bin);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Not world-readable:\n.*embedded\.provisionprofile/);
  });
});

test("a directory other users cannot enter fails", () => {
  withFixture((root, { bin, app }) => {
    chmodSync(join(app, "Contents/Resources/app.asar.unpacked"), 0o744);
    const result = verify(root, bin);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /app\.asar\.unpacked/);
  });
});

test("the afterPack hook embeds a 0600 profile at 0644 and fixes owner-only modes", () => {
  withFixture((root, { bin, app }) => {
    const staged = join(root, "tiao.provisionprofile");
    writeFileSync(staged, "store profile", { mode: 0o600 });
    chmodSync(staged, 0o600);
    rmSync(join(app, "Contents/embedded.provisionprofile"));
    chmodSync(join(app, "Contents/Resources/app.asar"), 0o600);
    chmodSync(join(app, "Contents/MacOS/Tiao"), 0o700);
    chmodSync(join(app, "Contents/Resources/app.asar.unpacked"), 0o700);

    prepareMasApp(app, staged);

    assert.equal(mode(join(app, "Contents/embedded.provisionprofile")), 0o644);
    assert.equal(mode(join(app, "Contents/Resources/app.asar")), 0o644);
    assert.equal(mode(join(app, "Contents/MacOS/Tiao")), 0o755, "executables stay executable");
    assert.equal(mode(join(app, "Contents/Resources/app.asar.unpacked")), 0o755);
    assert.equal(mode(staged), 0o600, "the staged profile is left alone");
    const result = verify(root, bin);
    assert.equal(result.status, 0, result.stderr);
  });
});
