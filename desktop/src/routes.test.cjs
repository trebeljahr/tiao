// @ts-check
/**
 * Runs desktop/src/routes.cjs against the fixture shared with the
 * mobile routers (mobile/scripts/routes-cases.txt), so the desktop
 * app:// handler and the iOS/Android apps resolve paths identically.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { resolveRoute, rootShellHtml } = require("./routes.cjs");

const FIXTURE = path.join(__dirname, "..", "..", "mobile", "scripts", "routes-cases.txt");

function loadFixture() {
  /** @type {Set<string>} */
  const files = new Set();
  /** @type {Array<[string, string]>} */
  const cases = [];
  for (const raw of fs.readFileSync(FIXTURE, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === "F" && parts.length === 2) files.add(parts[1]);
    else if (parts[0] === "C" && parts.length === 3) cases.push([parts[1], parts[2]]);
    else throw new Error(`unparseable fixture line: ${line}`);
  }
  return { files, cases };
}

describe("resolveRoute (shared mobile fixture)", () => {
  const { files, cases } = loadFixture();
  test("fixture has cases", () => {
    assert.ok(cases.length > 20);
  });
  for (const [request, expected] of cases) {
    test(`${request} -> ${expected}`, () => {
      assert.equal(
        resolveRoute(request, (p) => files.has(p)),
        expected,
      );
    });
  }
});

describe("resolveRoute (desktop extras)", () => {
  const exists = () => true;
  test("backslash segments are rejected", () => {
    assert.equal(resolveRoute("/en/..\\..\\secret.txt", exists), "/index.html");
  });
  test("NUL bytes are rejected", () => {
    assert.equal(resolveRoute("/en/a\0b.txt", exists), "/index.html");
  });
});

describe("rootShellHtml", () => {
  test("keeps the request's locale", () => {
    assert.match(rootShellHtml("/de/nope/"), /location\.replace\("\/de\/"\)/);
  });
  test("defaults to en", () => {
    assert.match(rootShellHtml("/"), /location\.replace\("\/en\/"\)/);
    assert.match(rootShellHtml("/nope/"), /location\.replace\("\/en\/"\)/);
  });
});
