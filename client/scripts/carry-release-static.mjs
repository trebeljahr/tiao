#!/usr/bin/env node
/**
 * Carry the browser assets of earlier releases into the next client upload.
 *
 *   fetch --site <origin> --out <dir> [--keep 2]
 *   Reads <origin>/release-assets.json, which every web upload publishes (see
 *   finalize-web-export.mjs), and downloads the files of its newest --keep
 *   releases into <out>/<sha>/..., each checked against its sha256, plus
 *   <out>/releases.json. A site without the manifest yields an empty carry
 *   and `"manifest": false`, so the caller can fall back to `compose`.
 *
 *   The commands below carry from a client Docker image instead. The web
 *   client ran as one until it moved to Cloudflare; the first upload there
 *   carries the image's assets.
 *
 *   compose --previous-dir <dir> --previous-sha <sha> --out <dir> [--keep 2]
 *     <dir>/static          the previous image's own .next/static
 *     <dir>/release-static  what the previous image carried (optional)
 *   Writes <out>/<sha>/... for the previous release and the releases it still
 *   carried, newest first, at most --keep in total, plus <out>/releases.json.
 *   A missing or empty previous dir yields an empty carry (first build).
 *   --serving-dir/--serving-sha add the image actually serving traffic first
 *   when it is not the previous build (e.g. builds pushed but never deployed).
 *
 *   verify --own <client/.next/static> --carried <dir> [--max-bytes N]
 *   Fails when one path holds different bytes in two releases (hashed names
 *   must never collide) or when the carry exceeds its size limit. Next's
 *   per-build manifests are exempt: with deploymentId set, Next 16 uses one
 *   fixed build ID, so every release has `<buildId>/_buildManifest.js` with
 *   its own bytes, and release-assets.mjs always serves the running build's.
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
import { dirname, join, relative, sep } from "node:path";

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

export function compose({ previousDir, previousSha, servingDir, servingSha, out, keep = 2 }) {
  mkdirSync(out, { recursive: true });
  const releases = [];
  // The release actually serving traffic (when it differs from the previous
  // build) comes first: its open tabs are the ones that need their chunks.
  const servingStatic = servingDir ? join(servingDir, "static") : "";
  if (
    servingDir &&
    servingSha !== previousSha &&
    existsSync(servingStatic) &&
    files(servingStatic).length
  ) {
    if (!SHA.test(servingSha ?? "")) throw new Error("--serving-sha must be a git SHA");
    cpSync(servingStatic, join(out, servingSha), { recursive: true, dereference: true });
    releases.push({ sha: servingSha });
  }
  const ownStatic = previousDir ? join(previousDir, "static") : "";
  if (previousDir && releases.length < keep && existsSync(ownStatic) && files(ownStatic).length) {
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

const PER_BUILD_MANIFEST = /^[^/]+\/_(build|ssg)Manifest\.js$/;

const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

export function verify({ own, carried, maxBytes = 200 * 1024 * 1024 }) {
  const seen = new Map();
  const remember = (base, path, label) => {
    if (PER_BUILD_MANIFEST.test(path.split(sep).join("/"))) return;
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

/** A manifest path names a file under /_next/static/ and nothing else. */
function safeStaticPath(path) {
  if (typeof path !== "string" || !path || /[\\\0?#]/.test(path)) return false;
  return path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

async function download(url, fetchImpl, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchImpl(url, { headers: { "Cache-Control": "no-cache" } });
      if (!response.ok) throw new Error(`${url} answered ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function fetchCarry({ site, out, keep = 2, fetchImpl = fetch, concurrency = 8 }) {
  mkdirSync(out, { recursive: true });
  const origin = new URL(site).origin;
  const response = await fetchImpl(`${origin}/release-assets.json`, {
    headers: { "Cache-Control": "no-cache" },
  });
  let releases = [];
  const manifest = response.ok;
  if (manifest) {
    const parsed = await response.json();
    if (parsed.schema !== 1 || !Array.isArray(parsed.releases))
      throw new Error("Unknown release-assets.json format");
    releases = parsed.releases.slice(0, keep);
  } else if (response.status !== 404) {
    throw new Error(`${origin}/release-assets.json answered ${response.status}`);
  }
  const jobs = [];
  for (const release of releases) {
    if (!SHA.test(release.sha ?? "")) throw new Error("Manifest release without a git SHA");
    for (const file of release.files ?? []) {
      if (!safeStaticPath(file.path))
        throw new Error(`Unsafe asset path in manifest: ${file.path}`);
      jobs.push({ sha: release.sha, ...file });
    }
  }
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      const url = `${origin}/_next/static/${job.path.split("/").map(encodeURIComponent).join("/")}`;
      const body = await download(url, fetchImpl);
      const hash = createHash("sha256").update(body).digest("hex");
      if (hash !== job.sha256)
        throw new Error(`/_next/static/${job.path} of ${job.sha} does not match its sha256`);
      const target = join(out, job.sha, ...job.path.split("/"));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, body);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  const carried = releases.map(({ sha }) => ({ sha }));
  writeFileSync(
    join(out, "releases.json"),
    `${JSON.stringify({ schema: 1, releases: carried }, null, 2)}\n`,
  );
  return { manifest, carried: carried.map((row) => row.sha), files: jobs.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, ...rest] = process.argv.slice(2);
  const options = args(rest);
  if (command === "fetch") {
    const result = await fetchCarry({
      site: options.site,
      out: options.out,
      keep: Number(options.keep ?? 2),
    });
    console.log(JSON.stringify(result));
  } else if (command === "compose") {
    const releases = compose({
      previousDir: options["previous-dir"],
      previousSha: options["previous-sha"],
      servingDir: options["serving-dir"],
      servingSha: options["serving-sha"],
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
    console.error("usage: carry-release-static.mjs fetch|compose|verify ...");
    process.exit(2);
  }
}
