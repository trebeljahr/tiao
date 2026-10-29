#!/usr/bin/env node
// Only Valve redistributables are copied; the Rust binding crate is not linked.
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

export const SDK_SOURCE = Object.freeze({
  version: "0.13.0",
  sdkVersion: "1.64",
  url: "https://static.crates.io/crates/steamworks-sys/steamworks-sys-0.13.0.crate",
  // crates.io sparse registry: https://index.crates.io/st/ea/steamworks-sys
  sha256: "ae139f051204a4af015d4f0ed3a1f7a51020d03a44c7cf249168c543d88131e9",
});

const ROOT = `steamworks-sys-${SDK_SOURCE.version}/lib/steam/redistributable_bin`;
export const SDK_FILES = Object.freeze({
  windows: { entry: `${ROOT}/win64/steam_api64.dll`, filename: "steam_api64.dll" },
  linux: { entry: `${ROOT}/linux64/libsteam_api.so`, filename: "libsteam_api.so" },
  macos: { entry: `${ROOT}/osx/libsteam_api.dylib`, filename: "libsteam_api.dylib" },
});
const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const MAX_TAR_BYTES = 64 * 1024 * 1024;

export const SDK_NOTICE = `Steamworks SDK ${SDK_SOURCE.sdkVersion} redistributable
Copyright Valve Corporation. All rights reserved.

Steam and the Steam logo are trademarks and/or registered trademarks of
Valve Corporation in the U.S. and/or other countries.

Source: steamworks-sys ${SDK_SOURCE.version}, published through crates.io
Archive: ${SDK_SOURCE.url}
SHA-256: ${SDK_SOURCE.sha256}
Upstream: https://github.com/Noxime/steamworks-rs
Steamworks SDK and applicable terms: https://partner.steamgames.com/doc/sdk
Redistribution documentation: https://partner.steamgames.com/doc/sdk/api

These Valve binaries are not covered by the Rust bindings' MIT/Apache licenses.
The registry archive supplies no separate Valve license text. Distribution of
the Steamworks SDK is subject to the developer's agreement with Valve.
`;

function stringField(header, start, length) {
  return header
    .subarray(start, start + length)
    .toString("utf8")
    .split("\0", 1)[0];
}

function octalField(header, start, length) {
  const value = stringField(header, start, length).trim();
  if (!/^[0-7]+$/.test(value)) throw new Error("Invalid tar numeric field");
  return Number.parseInt(value, 8);
}

// Do not extract the archive onto disk. Read only the exact allowlisted regular
// files, then write them under our own filenames; tar paths never become output paths.
export function selectTarFiles(tar, entries) {
  if (tar.length > MAX_TAR_BYTES) throw new Error("SDK tar exceeds size limit");
  const wanted = new Set(entries);
  const files = new Map();
  for (let offset = 0; offset < tar.length; ) {
    if (offset + 512 > tar.length) throw new Error("Truncated tar header");
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const checksum = header.reduce(
      (sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte),
      0,
    );
    if (octalField(header, 148, 8) !== checksum) throw new Error("Invalid tar checksum");
    const size = octalField(header, 124, 12);
    const name = stringField(header, 0, 100);
    const prefix = stringField(header, 345, 155);
    const path = prefix ? `${prefix}/${name}` : name;
    const start = offset + 512;
    if (start + size > tar.length) throw new Error("Truncated tar entry");
    if (wanted.has(path)) {
      if (header[156] !== 0 && header[156] !== 48) {
        throw new Error(`SDK entry must be a regular file: ${path}`);
      }
      if (files.has(path)) throw new Error(`Duplicate SDK entry: ${path}`);
      if (size === 0) throw new Error(`Empty SDK entry: ${path}`);
      files.set(path, tar.subarray(start, start + size));
    }
    offset = start + Math.ceil(size / 512) * 512;
  }
  for (const path of wanted) {
    if (!files.has(path)) throw new Error(`Missing SDK entry: ${path}`);
  }
  return files;
}

export function unpackSdk(archive, platforms) {
  if (archive.length > MAX_ARCHIVE_BYTES) throw new Error("SDK archive exceeds size limit");
  if (sha256(archive) !== SDK_SOURCE.sha256) throw new Error("Steam SDK archive checksum mismatch");
  const entries = platforms.map((platform) => {
    if (!Object.hasOwn(SDK_FILES, platform)) throw new Error(`Unsupported platform: ${platform}`);
    return SDK_FILES[platform].entry;
  });
  const tar = gunzipSync(archive, { maxOutputLength: MAX_TAR_BYTES });
  return selectTarFiles(tar, entries);
}

async function downloadSdk() {
  const response = await fetch(SDK_SOURCE.url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok || !response.body)
    throw new Error(`SDK download failed: HTTP ${response.status}`);
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > MAX_ARCHIVE_BYTES) throw new Error("SDK archive exceeds size limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// The verified archive, from `cachePath` when a copy with the pinned digest is
// there, otherwise downloaded once and written to `cachePath` for the next
// call (steam.yml stages two depots; CI caches the file by its digest).
export async function loadArchive(
  cachePath,
  { download = downloadSdk, expected = SDK_SOURCE.sha256 } = {},
) {
  if (cachePath) {
    try {
      const cached = await readFile(cachePath);
      if (sha256(cached) === expected) return cached;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const archive = await download();
  if (sha256(archive) !== expected) throw new Error("Steam SDK archive checksum mismatch");
  if (cachePath) {
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(`${cachePath}.download`, archive);
    await rename(`${cachePath}.download`, cachePath);
  }
  return archive;
}

export async function prepareSdk(platform, outputDirectory, archive) {
  if (!Object.hasOwn(SDK_FILES, platform)) throw new Error(`Unsupported platform: ${platform}`);
  const files = unpackSdk(archive ?? (await downloadSdk()), [platform]);
  const file = SDK_FILES[platform];
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(join(outputDirectory, file.filename), files.get(file.entry), { mode: 0o644 });
  await writeFile(join(outputDirectory, "STEAM-SDK-NOTICE.txt"), SDK_NOTICE);
}

async function main() {
  const [platform, outputDirectory, ...extra] = process.argv.slice(2);
  if (!platform || !outputDirectory || extra.length) {
    throw new Error(
      "Usage: node scripts/ci/prepare-steam-sdk.mjs <windows|linux|macos> <output-directory>",
    );
  }
  // STEAM_SDK_ARCHIVE: optional path of a cached copy of the archive.
  const cachePath = process.env.STEAM_SDK_ARCHIVE ? resolve(process.env.STEAM_SDK_ARCHIVE) : "";
  await prepareSdk(platform, resolve(outputDirectory), await loadArchive(cachePath));
  console.log(
    `Prepared Steamworks SDK ${SDK_SOURCE.sdkVersion} for ${platform} (${SDK_SOURCE.sha256})`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
