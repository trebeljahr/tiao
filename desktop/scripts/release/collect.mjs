// Stages one target's release files with a manifest and checksums.
//   node scripts/release/collect.mjs <platform> <arch> <signed|smoke>
// Reads dist/<channel>/ (from package.mjs), writes dist/upload/.
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { assertPackagedChannel, desktopTargets, repository, sha256, version } from "./lib.mjs";

const [platform, arch, mode] = process.argv.slice(2);
if (!["signed", "smoke"].includes(mode)) throw new Error("Missing release mode.");
const target = desktopTargets.find((t) => t.platform === platform && t.arch === arch);
if (!target) throw new Error("Unknown target: " + platform + "-" + arch);
const appVersion = version(JSON.parse(readFileSync("package.json", "utf8")).version);
const output = join("dist", "upload");
// Generated staging only: a retry must never upload stale files.
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

const channelOf = new Map();
const add = (path, name, channel) => {
  cpSync(path, join(output, name));
  channelOf.set(name, channel);
};
const matching = (directory, test, expected) => {
  const names = existsSync(directory) ? readdirSync(directory).filter(test) : [];
  if (expected !== undefined && names.length !== expected) {
    throw new Error(
      "Expected " + expected + " matching files in " + directory + "; found " + names.length,
    );
  }
  return names;
};
const withSuffix = (name, suffix) => name.replace(/(\.[A-Za-z]+)$/, "-" + suffix + "$1");
// Tar keeps executable bits and app symlinks through Actions artifact storage.
// COPYFILE_DISABLE stops macOS tar from adding AppleDouble ._* entries.
const depot = (directory, channel, label = channel + "-depot") => {
  const name = "Tiao-" + appVersion + "-" + platform + "-" + arch + "-" + label + ".tar.gz";
  execFileSync("tar", ["-czf", join(output, name), "-C", directory, "."], {
    stdio: "inherit",
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  channelOf.set(name, channel);
};
const unpacked = {
  macos: "mac-universal",
  mas: "mas-universal",
  windows: "win-unpacked",
  msstore: "win-unpacked",
  linux: "linux-unpacked",
}[platform];
const asarOf = (channel) => {
  const root = join("dist", channel, unpacked);
  return platform === "macos" || platform === "mas"
    ? join(root, "Tiao.app", "Contents", "Resources", "app.asar")
    : join(root, "resources", "app.asar");
};

for (const channel of target.channels) {
  assertPackagedChannel(asarOf(channel), channel);
  const dir = join("dist", channel);
  if (channel === "direct") {
    const packages = {
      macos: [".dmg", ".zip"],
      windows: ["-setup.exe", "-portable.exe"],
      linux: [".AppImage"],
    }[platform];
    for (const suffix of packages) {
      for (const name of matching(dir, (n) => n.endsWith(suffix), 1))
        add(join(dir, name), name, channel);
    }
    // Update feed metadata, for when the direct updater is switched on.
    for (const name of matching(dir, (n) => /^latest.*\.yml$/.test(n) || n.endsWith(".blockmap"))) {
      add(join(dir, name), name, channel);
    }
    if (platform === "windows" && mode === "signed") {
      add(
        join(dir, "windows-signatures.json"),
        "Tiao-" + appVersion + "-windows-signing-evidence.json",
        channel,
      );
    }
  } else if (channel === "itch") {
    const suffix = platform === "linux" ? ".AppImage" : ".zip";
    for (const name of matching(dir, (n) => n.endsWith(suffix), 1))
      add(join(dir, name), withSuffix(name, "itch"), channel);
  } else if (channel === "steam") {
    depot(join(dir, unpacked), channel);
  } else if (channel === "mas") {
    // A signed MAS build writes its pkg next to the app, not into dist/mas/.
    if (mode === "signed") {
      for (const name of matching(join(dir, unpacked), (n) => n.endsWith(".pkg"), 1))
        add(join(dir, unpacked, name), name, channel);
    } else {
      depot(join(dir, unpacked), channel, "unsigned-app"); // config check only; never publishable
    }
  } else if (channel === "msstore") {
    for (const name of matching(dir, (n) => n.endsWith(".appx"), 1))
      add(join(dir, name), name, channel);
  }
}

const files = readdirSync(output)
  .sort()
  .map((name) => ({ name, sha256: sha256(join(output, name)), channel: channelOf.get(name) }));
const manifest = {
  schema: 1,
  repository,
  commit:
    process.env.GITHUB_SHA ||
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  runId: process.env.GITHUB_RUN_ID || "local",
  version: appVersion,
  platform,
  arch,
  mode,
  signature:
    mode === "smoke"
      ? "unsigned"
      : {
          macos: "developer-id-notarized",
          mas: "apple-distribution",
          windows: "authenticode",
          msstore: "store-signed-on-submission",
          linux: "github-provenance",
        }[platform],
  files,
};
writeFileSync(
  join(output, "manifest-" + platform + "-" + arch + ".json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
writeFileSync(
  join(output, "SHA256SUMS-" + platform + "-" + arch + ".txt"),
  files.map((f) => f.sha256 + "  " + f.name).join("\n") + "\n",
);
console.log(files.map((f) => f.channel.padEnd(8) + f.name).join("\n"));
