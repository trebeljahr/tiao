// @ts-check
/**
 * resolveRequest against a real directory laid out like the shared
 * routes fixture, minus the root index.html the desktop export lacks.
 * Covers what routes.test.cjs can't: percent-decoding, the on-disk
 * existence check, the root containment re-check, and the generated
 * root shell.
 */

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { resolveRequest } = require("./protocol.cjs");

const FILES = [
  "/en/index.html",
  "/en/play/index.html",
  "/en/play/index.txt",
  "/en/game/__spa__/index.html",
  "/en/game/__spa__/index.txt",
  "/de/profile/__spa__/index.html",
  "/_next/static/chunks/app/[locale]/page-abc.js",
];

/** @type {string} */
let root;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tiao-protocol-"));
  for (const f of FILES) {
    const abs = path.join(root, f);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f);
  }
  // A sibling outside the bundle root that traversal must not reach.
  fs.writeFileSync(path.join(root, "..", `${path.basename(root)}-secret.txt`), "secret");
});

after(() => {
  fs.rmSync(path.join(root, "..", `${path.basename(root)}-secret.txt`), { force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

/** @param {string} urlPath */
function served(urlPath) {
  const r = resolveRequest(urlPath, root);
  if (!r) return null;
  if ("html" in r) return { html: r.html };
  return { file: `/${path.relative(root, r.file).split(path.sep).join("/")}` };
}

describe("resolveRequest", () => {
  test("unprefixed app links resolve to the en page", () => {
    assert.deepEqual(served("/play"), { file: "/en/play/index.html" });
    assert.deepEqual(served("/play/index.txt?_rsc=1"), { file: "/en/play/index.txt" });
  });

  test("dynamic routes serve the __spa__ page and RSC payload", () => {
    assert.deepEqual(served("/game/ABC123"), { file: "/en/game/__spa__/index.html" });
    assert.deepEqual(served("/en/game/ABC123/index.txt"), { file: "/en/game/__spa__/index.txt" });
    assert.deepEqual(served("/de/profile/rico%20t/"), { file: "/de/profile/__spa__/index.html" });
  });

  test("percent-encoded chunk paths are decoded", () => {
    assert.deepEqual(served("/_next/static/chunks/app/%5Blocale%5D/page-abc.js"), {
      file: "/_next/static/chunks/app/[locale]/page-abc.js",
    });
  });

  test("missing files stay as-is so the handler 404s", () => {
    assert.deepEqual(served("/_next/static/chunks/missing.js"), {
      file: "/_next/static/chunks/missing.js",
    });
  });

  test("root and unknown pages get the generated shell", () => {
    assert.match(served("/")?.html ?? "", /location\.replace\("\/en\/"\)/);
    assert.match(served("/de/nope/")?.html ?? "", /location\.replace\("\/de\/"\)/);
  });

  test("traversal never leaves the bundle root", () => {
    const secret = `${path.basename(root)}-secret.txt`;
    for (const p of [`/../${secret}`, `/%2E%2E/${secret}`, `/en/..%2F..%2F${secret}`]) {
      const r = served(p);
      assert.ok(r && "html" in r, `${p} should get the shell, got ${JSON.stringify(r)}`);
    }
  });

  test("malformed escapes are refused", () => {
    assert.equal(served("/%E0%A4%A"), null);
  });
});
