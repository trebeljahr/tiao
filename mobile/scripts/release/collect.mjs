import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildNumber, repository, sha256, version } from "./lib.mjs";

// Stage signed store files plus a SHA-256 manifest in release/upload/.
const [platform, arch, mode] = process.argv.slice(2);
if (!["signed", "smoke"].includes(mode)) throw new Error("Missing release mode.");
const appVersion = version(JSON.parse(readFileSync("package.json")).version);
const build = buildNumber(process.env.RELEASE_BUILD_NUMBER);
const output = "release/upload";
// This directory contains only generated release staging files.
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
const copy = (path, name) => cpSync(path, join(output, name));
const prefix = `Tiao-${appVersion}-${platform}-${build}`;
if (platform === "android" && arch === "universal") {
  copy("android/app/build/outputs/bundle/release/app-release.aab", `${prefix}.aab`);
  copy("android/app/build/outputs/apk/release/app-release.apk", `${prefix}.apk`);
  copy("android/app/build/outputs/mapping/release/mapping.txt", `${prefix}-mapping.txt`);
} else if (platform === "ios" && arch === "arm64") {
  const ipas = readdirSync("ios/App/build/ipa").filter((name) => name.endsWith(".ipa"));
  if (ipas.length !== 1) throw new Error("Expected exactly one exported IPA.");
  copy(join("ios/App/build/ipa", ipas[0]), `${prefix}.ipa`);
  // Tar keeps the dSYM bundle structure intact through Actions artifact storage.
  // COPYFILE_DISABLE stops macOS tar from adding AppleDouble ._* files.
  execFileSync(
    "tar",
    [
      "-czf",
      join(output, `${prefix}-symbols.tar.gz`),
      "-C",
      "ios/App/build/App.xcarchive",
      "dSYMs",
    ],
    { stdio: "inherit", env: { ...process.env, COPYFILE_DISABLE: "1" } },
  );
} else {
  throw new Error("Unknown platform or architecture.");
}
const files = readdirSync(output)
  .sort()
  .map((name) => ({ name, sha256: sha256(join(output, name)) }));
const manifest = {
  schema: 1,
  repository,
  commit:
    process.env.GITHUB_SHA ||
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  runId: process.env.GITHUB_RUN_ID || "local",
  version: appVersion,
  buildNumber: build,
  platform,
  arch,
  mode,
  signature: mode === "smoke" ? "unsigned" : "store-distribution",
  files,
};
writeFileSync(
  join(output, `manifest-${platform}-${arch}.json`),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
writeFileSync(
  join(output, `SHA256SUMS-${platform}-${arch}.txt`),
  `${files.map((f) => `${f.sha256}  ${f.name}`).join("\n")}\n`,
);
