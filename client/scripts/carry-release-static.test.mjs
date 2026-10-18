// @vitest-environment node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "vitest";
import { fetchCarry, verify } from "./carry-release-static.mjs";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);

function write(root, path, body) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), body);
}

const sha256 = (body) => createHash("sha256").update(body).digest("hex");

/** A fake live site: release-assets.json plus the files it lists. */
function site(manifest, files) {
  const requested = [];
  const fetchImpl = async (url) => {
    const { pathname } = new URL(url);
    requested.push(pathname);
    if (pathname === "/release-assets.json") {
      return manifest
        ? new Response(JSON.stringify(manifest), { status: 200 })
        : new Response("not found", { status: 404 });
    }
    const body = files[decodeURIComponent(pathname)];
    return body === undefined
      ? new Response("not found", { status: 404 })
      : new Response(body, { status: 200 });
  };
  return { fetchImpl, requested };
}

test("fetch carries the live release and what it carried, newest first, two at most", async () => {
  const out = join(mkdtempSync(join(tmpdir(), "tiao-fetch-")), "carry");
  const files = {
    "/_next/static/chunks/app/[locale]/page-b.js": "b page",
    "/_next/static/chunks/a.js": "a",
    "/_next/static/chunks/c.js": "c",
  };
  const entry = (path) => ({ path, sha256: sha256(files[`/_next/static/${path}`]) });
  const { fetchImpl, requested } = site(
    {
      schema: 1,
      releases: [
        { sha: B, files: [entry("chunks/app/[locale]/page-b.js")] },
        { sha: A, files: [entry("chunks/a.js")] },
        { sha: C, files: [entry("chunks/c.js")] },
      ],
    },
    files,
  );
  const result = await fetchCarry({ site: "https://playtiao.test/x", out, fetchImpl });
  assert.deepEqual(result, { manifest: true, carried: [B, A], files: 2 });
  assert.equal(readFileSync(join(out, B, "chunks/app/[locale]/page-b.js"), "utf8"), "b page");
  assert.equal(readFileSync(join(out, A, "chunks/a.js"), "utf8"), "a");
  assert.ok(!requested.includes("/_next/static/chunks/c.js"));
  assert.ok(requested.includes("/_next/static/chunks/app/%5Blocale%5D/page-b.js"));
  assert.deepEqual(JSON.parse(readFileSync(join(out, "releases.json"), "utf8")).releases, [
    { sha: B },
    { sha: A },
  ]);
  // The carry it wrote passes the collision check against a new build.
  const own = join(out, "..", "own");
  write(own, "chunks/new.js", "new");
  assert.deepEqual(verify({ own, carried: out }).releases, [B, A]);
});

test("fetch yields an empty carry when the site has no manifest yet", async () => {
  const out = join(mkdtempSync(join(tmpdir(), "tiao-fetch-")), "carry");
  const { fetchImpl } = site(null, {});
  assert.deepEqual(await fetchCarry({ site: "https://playtiao.test", out, fetchImpl }), {
    manifest: false,
    carried: [],
    files: 0,
  });
  assert.deepEqual(JSON.parse(readFileSync(join(out, "releases.json"), "utf8")).releases, []);
});

test("fetch refuses a file that does not match its hash, or an unsafe path", async () => {
  const out = join(mkdtempSync(join(tmpdir(), "tiao-fetch-")), "carry");
  const files = { "/_next/static/chunks/a.js": "tampered" };
  const bad = site(
    { schema: 1, releases: [{ sha: A, files: [{ path: "chunks/a.js", sha256: sha256("a") }] }] },
    files,
  );
  await assert.rejects(
    fetchCarry({ site: "https://playtiao.test", out, fetchImpl: bad.fetchImpl }),
    /sha256/,
  );
  const unsafe = site(
    { schema: 1, releases: [{ sha: A, files: [{ path: "../x.js", sha256: sha256("a") }] }] },
    {},
  );
  await assert.rejects(
    fetchCarry({ site: "https://playtiao.test", out, fetchImpl: unsafe.fetchImpl }),
    /Unsafe/,
  );
  const missing = site(
    { schema: 1, releases: [{ sha: A, files: [{ path: "chunks/gone.js", sha256: "0" }] }] },
    {},
  );
  await assert.rejects(
    fetchCarry({ site: "https://playtiao.test", out, fetchImpl: missing.fetchImpl }),
    /404/,
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
  // A build ID can repeat across releases (Next 16 with deploymentId); its manifests differ.
  write(own, "build-TfctsWXpff2fKS/_buildManifest.js", "new");
  write(carried, `${A}/build-TfctsWXpff2fKS/_buildManifest.js`, "old");
  write(own, "build-TfctsWXpff2fKS/_ssgManifest.js", "new");
  write(carried, `${A}/build-TfctsWXpff2fKS/_ssgManifest.js`, "old");
  assert.deepEqual(verify({ own, carried }).releases, [A]);
  write(carried, `${A}/chunks/x/_buildManifest.js`, "nested");
  write(own, "chunks/x/_buildManifest.js", "other");
  assert.throws(() => verify({ own, carried }), /collision/);
  write(own, "chunks/x/_buildManifest.js", "nested");
  assert.throws(() => verify({ own, carried, maxBytes: 2 }), /limit/);
  writeFileSync(
    join(carried, "releases.json"),
    JSON.stringify({ releases: [{ sha: A }, { sha: C }] }),
  );
  assert.throws(() => verify({ own, carried }), /no files/);
});
