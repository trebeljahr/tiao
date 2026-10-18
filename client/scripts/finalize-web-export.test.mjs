// @vitest-environment node
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "vitest";
import { finalize, headersFile, listFiles, redirectsFile } from "./finalize-web-export.mjs";

const COMMIT = "d".repeat(40);
const OLD = "e".repeat(40);

function write(root, path, body = path) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), body);
}

/** The shape of a Next web export with trailingSlash off. */
function exportFixture() {
  const out = mkdtempSync(join(tmpdir(), "tiao-export-"));
  for (const locale of ["en", "de", "es"]) {
    write(
      out,
      `${locale}.html`,
      `<html lang="${locale}"><script src="/_next/static/chunks/main.js">`,
    );
    write(out, `${locale}.txt`);
    write(out, `${locale}/__next._tree.txt`);
    write(out, `${locale}/play.html`);
    write(out, `${locale}/play.txt`);
    write(out, `${locale}/creators/rico.html`);
    for (const route of ["game", "embed/game"]) {
      write(out, `${locale}/${route}/__spa__.html`);
      write(out, `${locale}/${route}/__spa__.txt`);
      write(out, `${locale}/${route}/__spa__/__next._tree.txt`);
    }
  }
  write(out, "404.html");
  write(out, "creators/rico.jpg", "public file");
  write(out, "_next/static/chunks/main.js", "main");
  write(out, "_next/static/build1/_buildManifest.js", "manifest");
  return out;
}

test("moves English to the root and writes the routing files", () => {
  const out = exportFixture();
  const result = finalize({ out, commit: COMMIT, appVersion: "1.0.0", builtAt: new Date(0) });
  assert.deepEqual(result.routes, ["embed/game", "game"]);
  assert.deepEqual(result.releases, [COMMIT]);
  assert.ok(!existsSync(join(out, "en")));
  assert.ok(!existsSync(join(out, "en.html")));
  assert.match(readFileSync(join(out, "index.html"), "utf8"), /lang="en"/);
  for (const path of [
    "index.txt",
    "__next._tree.txt",
    "play.html",
    "creators/rico.html",
    "creators/rico.jpg",
    "game/__spa__.html",
    "game/__spa__/__next._tree.txt",
    "de/play.html",
    "de.html",
  ])
    assert.ok(existsSync(join(out, path)), path);
  assert.deepEqual(JSON.parse(readFileSync(join(out, "version.json"), "utf8")), {
    commit: COMMIT,
    version: "1.0.0",
    builtAt: "1970-01-01T00:00:00.000Z",
  });
  assert.equal(readFileSync(join(out, "_redirects"), "utf8"), redirectsFile(result.routes));
  assert.equal(readFileSync(join(out, "_headers"), "utf8"), headersFile());
  const manifest = JSON.parse(readFileSync(join(out, "release-assets.json"), "utf8"));
  assert.deepEqual(
    manifest.releases[0].files.map((file) => file.path),
    ["build1/_buildManifest.js", "chunks/main.js"],
  );
  assert.match(manifest.releases[0].files[1].sha256, /^[0-9a-f]{64}$/);
  assert.throws(() => finalize({ out, commit: COMMIT }), /already finalized/);
});

test("redirects map every id of a dynamic route onto its placeholder files", () => {
  const rules = redirectsFile(["game"])
    .split("\n")
    .filter((line) => line && !line.startsWith("#"));
  assert.deepEqual(rules, [
    "/en / 301",
    "/en/* /:splat 301",
    "/game/:id/ /game/:id 308",
    "/game/:id.txt /game/__spa__.txt 200",
    "/game/:id/* /game/__spa__/:splat 200",
    "/game/:id /game/__spa__ 200",
    "/:locale/game/:id/ /:locale/game/:id 308",
    "/:locale/game/:id.txt /:locale/game/__spa__.txt 200",
    "/:locale/game/:id/* /:locale/game/__spa__/:splat 200",
    "/:locale/game/:id /:locale/game/__spa__ 200",
  ]);
});

test("refuses an export whose locales disagree, or that would overwrite a file", () => {
  const missing = exportFixture();
  write(missing, "en/profile/__spa__.html");
  assert.throws(() => finalize({ out: missing, commit: COMMIT }), /Placeholder routes differ/);

  const clash = exportFixture();
  write(clash, "play.html", "public file in the way");
  assert.throws(() => finalize({ out: clash, commit: COMMIT }), /overwrite play\.html/);
  assert.ok(existsSync(join(clash, "en/play.html")), "nothing moved before the check");
});

test("refuses a relative asset prefix and a bad commit", () => {
  const out = exportFixture();
  write(out, "en/rules.html", '<script src="./_next/static/chunks/main.js">');
  assert.throws(() => finalize({ out, commit: COMMIT }), /references \.\/_next/);
  assert.throws(() => finalize({ out: exportFixture(), commit: "HEAD" }), /full git SHA/);
});

test("adds carried releases' files and lists them for the next build", () => {
  const out = exportFixture();
  const carried = mkdtempSync(join(tmpdir(), "tiao-carried-"));
  write(carried, `${OLD}/chunks/old.js`, "old");
  write(carried, `${OLD}/chunks/main.js`, "main");
  write(carried, "releases.json", JSON.stringify({ schema: 1, releases: [{ sha: OLD }] }));
  const result = finalize({ out, commit: COMMIT, carried });
  assert.deepEqual(result.releases, [COMMIT, OLD]);
  assert.equal(readFileSync(join(out, "_next/static/chunks/old.js"), "utf8"), "old");
  const manifest = JSON.parse(readFileSync(join(out, "release-assets.json"), "utf8"));
  assert.deepEqual(
    manifest.releases.map((release) => [release.sha, release.files.map((file) => file.path)]),
    [
      [COMMIT, ["build1/_buildManifest.js", "chunks/main.js"]],
      [OLD, ["chunks/main.js", "chunks/old.js"]],
    ],
  );

  const clash = exportFixture();
  const other = mkdtempSync(join(tmpdir(), "tiao-carried-"));
  write(other, `${OLD}/chunks/main.js`, "different bytes");
  write(other, "releases.json", JSON.stringify({ schema: 1, releases: [{ sha: OLD }] }));
  assert.throws(() => finalize({ out: clash, commit: COMMIT, carried: other }), /collision/);
});

test("headers deny framing except for the embed routes", () => {
  const text = headersFile();
  assert.match(text, /^\/\*\n {2}X-Frame-Options: DENY\n/m);
  assert.match(text, /^\/:locale\/embed\/\*\n {2}! X-Frame-Options\n/m);
  assert.match(text, /^\/sw\.js\n {2}Cache-Control: no-cache$/m);
  // No long-lived caching under /_next/static: it would also cover 404s.
  assert.doesNotMatch(text, /immutable/);
});

test("listFiles uses forward slashes and sorts", () => {
  const out = exportFixture();
  assert.deepEqual(listFiles(join(out, "_next")), [
    "static/build1/_buildManifest.js",
    "static/chunks/main.js",
  ]);
});
