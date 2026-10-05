#!/usr/bin/env node
/**
 * Carry the browser assets of earlier releases into the next client image.
 *
 *   compose --previous-dir <dir> --previous-sha <sha> --out <dir> [--keep 2]
 *     <dir>/static          the previous image's own .next/static
 *     <dir>/release-static  what the previous image carried (optional)
 *   Writes <out>/<sha>/... for the previous release and the releases it still
 *   carried, newest first, at most --keep in total, plus <out>/releases.json.
 *   A missing or empty previous dir yields an empty carry (first build).
 *
 *   verify --own <client/.next/static> --carried <dir> [--max-bytes N]
 *   Fails when one path holds different bytes in two releases (hashed names
 *   must never collide) or when the carry exceeds its size limit.
 */

import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";

const SHA = /^[0-9a-f]{7,40}$/;

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith("--")) throw new Error(`Unexpected argument ${argv[i]}`);
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

function files(dir) {
  const found = [];
  if (!existsSync(dir)) return found;
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Refusing symlink in release assets: ${path}`);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) found.push(relative(dir, path));
    }
  };
  walk(dir);
  return found;
}

function readManifest(dir) {
  const path = join(dir, "releases.json");
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return (parsed.releases ?? []).filter((row) => SHA.test(row?.sha ?? ""));
}

export function compose({ previousDir, previousSha, out, keep = 2 }) {
  mkdirSync(out, { recursive: true });
  const releases = [];
  const ownStatic = previousDir ? join(previousDir, "static") : "";
  if (previousDir && existsSync(ownStatic) && files(ownStatic).length) {
    if (!SHA.test(previousSha ?? "")) throw new Error("--previous-sha must be a git SHA");
    cpSync(ownStatic, join(out, previousSha), { recursive: true, dereference: true });
    releases.push({ sha: previousSha });
    const carried = join(previousDir, "release-static");
    for (const row of readManifest(carried)) {
      if (releases.length >= keep) break;
      if (releases.some((existing) => existing.sha === row.sha)) continue;
      if (!existsSync(join(carried, row.sha))) continue;
      cpSync(join(carried, row.sha), join(out, row.sha), { recursive: true, dereference: true });
      releases.push({ sha: row.sha });
    }
  }
  writeFileSync(
    join(out, "releases.json"),
    `${JSON.stringify({ schema: 1, releases }, null, 2)}\n`,
  );
  return releases;
}

const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

export function verify({ own, carried, maxBytes = 200 * 1024 * 1024 }) {
  const seen = new Map();
  const remember = (base, path, label) => {
    const hash = digest(join(base, path));
    const previous = seen.get(path);
    if (previous && previous.hash !== hash)
      throw new Error(
        `Asset collision at /_next/static/${path} between ${previous.label} and ${label}`,
      );
    if (!previous) seen.set(path, { hash, label });
  };
  for (const path of files(own)) remember(own, path, "this build");
  let bytes = 0;
  const releases = readManifest(carried);
  for (const { sha } of releases) {
    const dir = join(carried, sha);
    const found = files(dir);
    if (!found.length) throw new Error(`Carried release ${sha} has no files`);
    for (const path of found) {
      bytes += statSync(join(dir, path)).size;
      remember(dir, path, sha);
    }
  }
  if (bytes > maxBytes)
    throw new Error(`Carried release assets use ${bytes} bytes (limit ${maxBytes})`);
  return { releases: releases.map((row) => row.sha), bytes };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, ...rest] = process.argv.slice(2);
  const options = args(rest);
  if (command === "compose") {
    const releases = compose({
      previousDir: options["previous-dir"],
      previousSha: options["previous-sha"],
      out: options.out,
      keep: Number(options.keep ?? 2),
    });
    console.log(JSON.stringify({ carried: releases.map((row) => row.sha) }));
  } else if (command === "verify") {
    const result = verify({
      own: options.own,
      carried: options.carried,
      ...(options["max-bytes"] ? { maxBytes: Number(options["max-bytes"]) } : {}),
    });
    console.log(JSON.stringify(result));
  } else {
    console.error("usage: carry-release-static.mjs compose|verify ...");
    process.exit(2);
  }
}
