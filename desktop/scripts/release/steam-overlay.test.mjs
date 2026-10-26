import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { writeAsar } from "./fixtures.mjs";

const script = fileURLToPath(new URL("./verify-app-macos.sh", import.meta.url));
const plist = readFileSync(
  new URL("../../build/entitlements.steam.plist", import.meta.url),
  "utf8",
);

function verify({
  steam = true,
  entitlements = plist,
  presenter = true,
  stapleFailures = 0,
  stapleError = 'Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost."',
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "tiao-overlay-gate-"));
  try {
    const app = join(root, "Tiao Demo.app");
    const bin = join(root, "bin");
    const contents = join(app, "Contents");
    const native = join(contents, "Resources/app.asar.unpacked/src");
    mkdirSync(native, { recursive: true });
    mkdirSync(join(contents, "MacOS"));
    mkdirSync(bin);
    writeFileSync(
      join(contents, "Info.plist"),
      `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Tiao</string></dict></plist>`,
    );
    writeFileSync(join(contents, "MacOS/Tiao"), "binary");
    writeAsar(join(contents, "Resources/app.asar"), {
      "package.json": JSON.stringify({ steamBuild: steam }),
    });
    if (presenter) writeFileSync(join(native, "steamOverlayMac.node"), "binary");
    const stub = (name, body) =>
      writeFileSync(join(bin, name), "#!/bin/bash\n" + body + "\n", { mode: 0o755 });
    stub(
      "codesign",
      'case "$*" in *--entitlements*) printf "%s" "$TEST_ENTITLEMENTS" ;; *-dv*) printf "TeamIdentifier=4BHY8H2J25\\nflags=0x10000(runtime)\\n" ;; esac',
    );
    stub("spctl", 'echo "source=Notarized Developer ID"');
    stub(
      "xcrun",
      `
count=0
[[ ! -f "$TEST_STAPLE_COUNTER" ]] || count=$(cat "$TEST_STAPLE_COUNTER")
count=$((count + 1))
printf '%s' "$count" > "$TEST_STAPLE_COUNTER"
if [[ "$count" -le "$TEST_STAPLE_FAILURES" ]]; then
  printf '%s\\n' "$TEST_STAPLE_ERROR" >&2
  exit 68
fi
echo 'The validate action worked!'
`,
    );
    stub("sleep", 'printf "%s\\n" "$1" >> "$TEST_STAPLE_SLEEPS"');
    stub("lipo", 'echo "x86_64 arm64"');
    const counter = join(root, "staple-attempts");
    const sleeps = join(root, "staple-sleeps");
    writeFileSync(sleeps, "");
    const result = spawnSync("bash", [script, app], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: bin + ":" + process.env.PATH,
        TEST_ENTITLEMENTS: entitlements,
        TEST_STAPLE_COUNTER: counter,
        TEST_STAPLE_SLEEPS: sleeps,
        TEST_STAPLE_FAILURES: String(stapleFailures),
        TEST_STAPLE_ERROR: stapleError,
      },
    });
    return {
      ...result,
      stapleAttempts: Number(readFileSync(counter, "utf8")),
      stapleSleeps: readFileSync(sleeps, "utf8"),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("signed Steam artifact gate accepts the universal presenter and injection entitlements", {
  skip: process.platform !== "darwin",
}, () => {
  const result = verify();
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
for (const key of ["allow-dyld-environment-variables", "disable-library-validation"]) {
  test(`signed Steam gate rejects a missing ${key} entitlement`, {
    skip: process.platform !== "darwin",
  }, () => {
    const result = verify({
      entitlements: plist.replace(
        new RegExp(`<key>com.apple.security.cs.${key}</key>\\s*<true/>`),
        "",
      ),
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing Steam entitlement/);
  });
}
test("signed Steam gate rejects an absent native presenter", {
  skip: process.platform !== "darwin",
}, () => {
  const result = verify({ presenter: false });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing Steam Metal presenter/);
});
test("other channels do not require a Steam presenter or injection entitlement", {
  skip: process.platform !== "darwin",
}, () => {
  const result = verify({ steam: false, presenter: false, entitlements: "" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("a lost Apple ticket connection retries validation and still verifies the Steam artifact", {
  skip: process.platform !== "darwin",
}, () => {
  const result = verify({ stapleFailures: 1 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.stapleAttempts, 2);
  assert.equal(result.stapleSleeps, "20\n");
});

test("persistent Apple ticket network failures stop after three validations", {
  skip: process.platform !== "darwin",
}, () => {
  const result = verify({ stapleFailures: 3 });
  assert.equal(result.status, 68);
  assert.equal(result.stapleAttempts, 3);
  assert.equal(result.stapleSleeps, "20\n20\n");
});

test("an invalid staple fails immediately without a retry", {
  skip: process.platform !== "darwin",
}, () => {
  const result = verify({ stapleFailures: 1, stapleError: "The staple is invalid." });
  assert.equal(result.status, 68);
  assert.equal(result.stapleAttempts, 1);
  assert.equal(result.stapleSleeps, "");
});
