#!/usr/bin/env node
// One product version for Tiao releases.
//
// desktop/package.json "version" is what Tauri, the packaged app
// (CARGO_PKG_VERSION), artifact names, butler --userversion, the Steam build
// description and the desktop-vX.Y.Z tag all read. The monorepo root
// package.json mirrors it so the repository states one version.
//
//   node scripts/release/version.mjs 0.2.0   write 0.2.0 to both files
//   node scripts/release/version.mjs --check  write nothing; exit 1 on drift
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { version } from "./lib.mjs";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const versionFiles = [
  join(desktop, "package.json"),
  join(desktop, "..", "package.json"),
  join(desktop, "src-tauri", "tauri.conf.json"),
  join(desktop, "src-tauri", "Cargo.toml"),
];
const pattern = /^(\s*(?:"version"\s*:|version\s*=)\s*")([^"]*)(")/m;

export function readVersion(text) {
  const match = pattern.exec(text);
  if (!match) throw new Error('No top-level "version" field.');
  return match[2];
}

export function writeVersion(text, value) {
  readVersion(text);
  return text.replace(pattern, (_all, before, _old, after) => before + version(value) + after);
}

export function checkVersions(texts) {
  const values = texts.map(readVersion);
  values.forEach(version);
  if (new Set(values).size !== 1) throw new Error("Versions disagree: " + values.join(" vs "));
  return values[0];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [arg] = process.argv.slice(2);
  if (arg === "--check") {
    console.log("version " + checkVersions(versionFiles.map((file) => readFileSync(file, "utf8"))));
  } else if (arg) {
    for (const file of versionFiles)
      writeFileSync(file, writeVersion(readFileSync(file, "utf8"), arg));
    const lock = join(desktop, "src-tauri", "Cargo.lock");
    writeFileSync(
      lock,
      readFileSync(lock, "utf8").replace(
        /(name = "tiao"\nversion = ")[^"]+"/,
        "$1" + version(arg) + '"',
      ),
    );
    console.log("version set to " + arg + " in " + (versionFiles.length + 1) + " files");
  } else {
    throw new Error("Usage: version.mjs X.Y.Z | --check");
  }
}
