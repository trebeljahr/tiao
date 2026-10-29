import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./collect.mjs", import.meta.url));

function linuxFixture(meta = {}) {
  const fixture = mkdtempSync(join(tmpdir(), "tiao-collect-"));
  writeFileSync(join(fixture, "package.json"), '{"version":"1.2.3"}');
  for (const channel of ["direct", "itch", "steam", "steam-demo"]) {
    const resources = join(fixture, "dist", channel, "linux-unpacked");
    mkdirSync(resources, { recursive: true });
    const baked = {
      runtime: "tauri",
      steamBuild: false,
      steamDemo: false,
      distributionChannel: channel,
      ...(["steam", "steam-demo"].includes(channel)
        ? {
            steamBuild: true,
            steamAppId: channel === "steam-demo" ? 5491870 : 5035580,
            steamDemo: channel === "steam-demo",
          }
        : {}),
      ...meta[channel],
    };
    writeFileSync(join(resources, "tiao-build.json"), JSON.stringify(baked));
    writeFileSync(join(fixture, "dist", channel, "linux-unpacked", "tiao"), "test executable");
    chmodSync(join(fixture, "dist", channel, "linux-unpacked", "tiao"), 0o755);
  }
  writeFileSync(join(fixture, "dist/direct/Tiao-1.2.3-linux-x86_64.AppImage"), "direct image");
  writeFileSync(join(fixture, "dist/direct/latest-linux.yml"), "version: 1.2.3");
  writeFileSync(join(fixture, "dist/itch/Tiao-1.2.3-linux-x86_64.AppImage"), "itch image");
  return fixture;
}

const collect = (fixture) =>
  execFileSync(process.execPath, [script, "linux", "x64", "smoke"], {
    cwd: fixture,
    env: { ...process.env, GITHUB_SHA: "a".repeat(40), GITHUB_RUN_ID: "123" },
    stdio: "pipe",
  });

test("Linux collection tags every file with its channel, keeps executables and drops stale staging files", () => {
  const fixture = linuxFixture();
  try {
    collect(fixture);
    writeFileSync(join(fixture, "dist/upload/stale-secret.txt"), "must not be uploaded");
    collect(fixture);
    const output = join(fixture, "dist/upload");
    assert.equal(readdirSync(output).includes("stale-secret.txt"), false);
    const manifest = JSON.parse(readFileSync(join(output, "manifest-linux-x64.json"), "utf8"));
    assert.equal(manifest.mode, "smoke");
    assert.equal(manifest.signature, "unsigned");
    assert.deepEqual(
      manifest.files.map((f) => [f.name, f.channel]),
      [
        ["Tiao-1.2.3-linux-x64-steam-demo-depot.tar.gz", "steam-demo"],
        ["Tiao-1.2.3-linux-x64-steam-depot.tar.gz", "steam"],
        ["Tiao-1.2.3-linux-x86_64-itch.AppImage", "itch"],
        ["Tiao-1.2.3-linux-x86_64.AppImage", "direct"],
      ],
    );
    const listing = execFileSync(
      "tar",
      ["-tvzf", join(output, "Tiao-1.2.3-linux-x64-steam-depot.tar.gz")],
      { encoding: "utf8" },
    );
    assert.match(listing, /-rwxr-xr-x.*tiao/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("collection refuses a build whose baked channel is wrong", () => {
  const fixture = linuxFixture({ itch: { distributionChannel: "direct" } });
  try {
    assert.throws(() => collect(fixture), /runtime\/channel/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("updater signatures retain their payload filename and exact bytes", () => {
  const fixture = linuxFixture();
  const name = "Tiao-1.2.3-linux-x86_64.AppImage";
  try {
    writeFileSync(join(fixture, "dist/direct", name + ".sig"), "verified signature");
    collect(fixture);
    const output = join(fixture, "dist/upload");
    assert.equal(readFileSync(join(output, name), "utf8"), "direct image");
    assert.equal(readFileSync(join(output, name + ".sig"), "utf8"), "verified signature");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
