// @vitest-environment node
import assert from "node:assert/strict";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "vitest";
import { createReleaseAssets, staticRelativePath } from "./release-assets.mjs";
import { compose, verify } from "./scripts/carry-release-static.mjs";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);

function write(root, path, body) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), body);
}

function response() {
  const res = new PassThrough();
  const chunks = [];
  res.on("data", (chunk) => chunks.push(chunk));
  res.writeHead = (status, headers) => {
    res.status = status;
    res.headers = headers;
  };
  res.body = () => Buffer.concat(chunks).toString();
  return res;
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "tiao-release-assets-"));
  const own = join(root, "own");
  const carried = join(root, "carried");
  write(own, "chunks/own.js", "own");
  write(carried, `${A}/chunks/old.js`, "old release chunk");
  write(carried, `${B}/chunks/older.js`, "older");
  write(carried, `${A}/chunks/own.js`, "stale copy must not win");
  writeFileSync(
    join(carried, "releases.json"),
    JSON.stringify({ schema: 1, releases: [{ sha: A }, { sha: B }] }),
  );
  return { root, own, carried };
}

test("serves a carried chunk the running build lacks, with immutable caching", async () => {
  const { own, carried } = fixture();
  const assets = createReleaseAssets({ ownStaticDir: own, carriedDir: carried });
  assert.deepEqual(assets.releases, [A, B]);
  const res = response();
  assert.equal(assets.serve({ method: "GET" }, res, "/_next/static/chunks/old.js"), true);
  await new Promise((resolve) => res.on("end", resolve));
  assert.equal(res.status, 200);
  assert.equal(res.body(), "old release chunk");
  assert.match(res.headers["Cache-Control"], /immutable/);
  assert.equal(res.headers["Content-Type"], "application/javascript; charset=utf-8");
  assert.equal(res.headers["X-Tiao-Release-Asset"], A);
  const older = response();
  assert.equal(assets.serve({ method: "HEAD" }, older, "/_next/static/chunks/older.js"), true);
  assert.equal(older.headers["X-Tiao-Release-Asset"], B);
});

test("leaves own, unknown, unsafe and non-GET paths to Next", () => {
  const { own, carried } = fixture();
  const assets = createReleaseAssets({ ownStaticDir: own, carriedDir: carried });
  for (const path of [
    "/_next/static/chunks/own.js",
    "/_next/static/chunks/missing.js",
    "/_next/static/../../etc/passwd",
    "/_next/static/chunks/%2e%2e/%2e%2e/secret",
    "/_next/static/",
    "/other/chunks/old.js",
  ])
    assert.equal(assets.serve({ method: "GET" }, response(), path), false, path);
  assert.equal(assets.serve({ method: "POST" }, response(), "/_next/static/chunks/old.js"), false);
  assert.equal(staticRelativePath("/_next/static/a//b.js"), null);
});

test("without a carry manifest nothing is served", () => {
  const root = mkdtempSync(join(tmpdir(), "tiao-release-assets-"));
  const assets = createReleaseAssets({ ownStaticDir: root, carriedDir: join(root, "none") });
  assert.deepEqual(assets.releases, []);
  assert.equal(assets.serve({ method: "GET" }, response(), "/_next/static/x.js"), false);
});

test("refuses router and action requests from another release only", () => {
  const { own, carried } = fixture();
  const assets = createReleaseAssets({ ownStaticDir: own, carriedDir: carried, deploymentId: C });
  const foreign = { "x-deployment-id": A };
  assert.equal(assets.isForeignFlight({ headers: { ...foreign, rsc: "1" } }), true);
  assert.equal(assets.isForeignFlight({ headers: { ...foreign, "next-action": "x" } }), true);
  assert.equal(assets.isForeignFlight({ headers: { ...foreign } }), false);
  assert.equal(assets.isForeignFlight({ headers: { "x-deployment-id": C, rsc: "1" } }), false);
  assert.equal(assets.isForeignFlight({ headers: { rsc: "1" } }), false);
  const res = response();
  assets.refuseForeignFlight(res);
  assert.equal(res.status, 409);
  assert.equal(res.headers["Cache-Control"], "no-store");
  const undeployed = createReleaseAssets({ ownStaticDir: own, carriedDir: carried });
  assert.equal(undeployed.isForeignFlight({ headers: { ...foreign, rsc: "1" } }), false);
});

test("compose carries the previous release and what it carried, newest first, two at most", () => {
  const root = mkdtempSync(join(tmpdir(), "tiao-carry-"));
  const previous = join(root, "previous");
  write(previous, "static/chunks/b.js", "b");
  write(previous, `release-static/${A}/chunks/a.js`, "a");
  write(previous, `release-static/${C}/chunks/c.js`, "c");
  writeFileSync(
    join(previous, "release-static/releases.json"),
    JSON.stringify({ schema: 1, releases: [{ sha: A }, { sha: C }] }),
  );
  const out = join(root, "out");
  const releases = compose({ previousDir: previous, previousSha: B, out });
  assert.deepEqual(
    releases.map((row) => row.sha),
    [B, A],
  );
  assert.equal(readFileSync(join(out, B, "chunks/b.js"), "utf8"), "b");
  assert.equal(readFileSync(join(out, A, "chunks/a.js"), "utf8"), "a");
  assert.deepEqual(JSON.parse(readFileSync(join(out, "releases.json"), "utf8")).releases, [
    { sha: B },
    { sha: A },
  ]);
  const legacy = join(root, "legacy");
  write(legacy, "static/chunks/l.js", "l");
  assert.deepEqual(
    compose({ previousDir: legacy, previousSha: C, out: join(root, "legacy-out") }).map(
      (row) => row.sha,
    ),
    [C],
  );
  assert.deepEqual(compose({ previousDir: join(root, "absent"), out: join(root, "empty") }), []);
  // A symlinked previous static dir is copied as files, never as a link.
  const linked = join(root, "linked");
  mkdirSync(linked);
  symlinkSync(join(previous, "static"), join(linked, "static"));
  const copied = join(root, "copied");
  compose({ previousDir: linked, previousSha: B, out: copied });
  assert.equal(lstatSync(join(copied, B)).isSymbolicLink(), false);
  assert.equal(readFileSync(join(copied, B, "chunks/b.js"), "utf8"), "b");
});

test("the serving release is carried first when it is not the previous build", () => {
  const root = mkdtempSync(join(tmpdir(), "tiao-carry-"));
  const previous = join(root, "previous");
  write(previous, "static/chunks/b.js", "b");
  write(previous, `release-static/${A}/chunks/a.js`, "a");
  writeFileSync(
    join(previous, "release-static/releases.json"),
    JSON.stringify({ schema: 1, releases: [{ sha: A }] }),
  );
  const serving = join(root, "serving");
  write(serving, "static/chunks/c.js", "c");
  const out = join(root, "out");
  const releases = compose({
    previousDir: previous,
    previousSha: B,
    servingDir: serving,
    servingSha: C,
    out,
  });
  assert.deepEqual(
    releases.map((row) => row.sha),
    [C, B],
  );
  assert.equal(readFileSync(join(out, C, "chunks/c.js"), "utf8"), "c");
  const same = compose({
    previousDir: previous,
    previousSha: B,
    servingDir: serving,
    servingSha: B,
    out: join(root, "same"),
  });
  assert.deepEqual(
    same.map((row) => row.sha),
    [B, A],
  );
});

test("verify rejects one asset path holding different bytes in two releases", () => {
  const root = mkdtempSync(join(tmpdir(), "tiao-carry-"));
  const own = join(root, "own");
  const carried = join(root, "carried");
  write(own, "chunks/shared.js", "same");
  write(carried, `${A}/chunks/shared.js`, "same");
  write(carried, `${A}/chunks/a.js`, "a");
  writeFileSync(join(carried, "releases.json"), JSON.stringify({ releases: [{ sha: A }] }));
  assert.deepEqual(verify({ own, carried }).releases, [A]);
  write(carried, `${A}/chunks/shared.js`, "different");
  assert.throws(() => verify({ own, carried }), /collision/);
  write(carried, `${A}/chunks/shared.js`, "same");
  assert.throws(() => verify({ own, carried, maxBytes: 2 }), /limit/);
  writeFileSync(
    join(carried, "releases.json"),
    JSON.stringify({ releases: [{ sha: A }, { sha: C }] }),
  );
  assert.throws(() => verify({ own, carried }), /no files/);
});
