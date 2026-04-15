// @ts-check
/**
 * Unit tests for desktop/src/csp.cjs.
 *
 * Uses node's built-in test runner (node --test) so we don't need
 * to pull vitest/jest into the desktop package. csp.cjs imports
 * zero Electron globals, so these tests run in plain Node.
 *
 * Covers:
 *   - strict prod policy for packaged builds, regardless of apiUrl
 *   - HMR mode (startUrl http://...) always uses dev policy
 *   - unpackaged + loopback http backend uses dev policy
 *     (the `dev:desktop` path that the CSP fix is about)
 *   - unpackaged + https backend still uses prod policy
 *   - relaxed policy actually permits `http://localhost:*` in
 *     connect-src, which was the specific breakage in the bug
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const {
  shouldUseDevCsp,
  selectCspPolicy,
  PROD_CONTENT_SECURITY_POLICY,
  DEV_CONTENT_SECURITY_POLICY,
} = require("./csp.cjs");

describe("shouldUseDevCsp", () => {
  test("packaged builds never use the dev policy, even with an http apiUrl", () => {
    assert.equal(
      shouldUseDevCsp({
        startUrl: "app://tiao/en/",
        apiUrl: "http://localhost:5250",
        isPackaged: true,
      }),
      false,
    );
    assert.equal(
      shouldUseDevCsp({
        startUrl: "app://tiao/en/",
        apiUrl: "https://api.playtiao.com",
        isPackaged: true,
      }),
      false,
    );
  });

  test("HMR mode always uses the dev policy", () => {
    assert.equal(
      shouldUseDevCsp({
        startUrl: "http://localhost:3000/en/",
        apiUrl: "https://api.playtiao.com",
        isPackaged: false,
      }),
      true,
    );
    // https start URL (rare, but possible if someone points HMR at a
    // TLS-terminated dev server)
    assert.equal(
      shouldUseDevCsp({
        startUrl: "https://dev.playtiao.test/en/",
        apiUrl: "https://api.playtiao.com",
        isPackaged: false,
      }),
      true,
    );
  });

  test("unpackaged dev:desktop (app:// start + loopback http backend) uses dev policy", () => {
    assert.equal(
      shouldUseDevCsp({
        startUrl: "app://tiao/en/",
        apiUrl: "http://localhost:5250",
        isPackaged: false,
      }),
      true,
    );
    // 127.0.0.1 should be treated the same as localhost
    assert.equal(
      shouldUseDevCsp({
        startUrl: "app://tiao/en/",
        apiUrl: "http://127.0.0.1:5005",
        isPackaged: false,
      }),
      true,
    );
  });

  test("unpackaged + https backend still uses prod policy", () => {
    assert.equal(
      shouldUseDevCsp({
        startUrl: "app://tiao/en/",
        apiUrl: "https://api.playtiao.com",
        isPackaged: false,
      }),
      false,
    );
  });

  test("unpackaged + non-loopback http backend still uses prod policy", () => {
    // An http:// origin that isn't loopback shouldn't relax CSP —
    // defense in depth against a misconfigured TIAO_API_URL pointing
    // at a LAN IP or public host.
    assert.equal(
      shouldUseDevCsp({
        startUrl: "app://tiao/en/",
        apiUrl: "http://192.168.1.10:5005",
        isPackaged: false,
      }),
      false,
    );
    assert.equal(
      shouldUseDevCsp({
        startUrl: "app://tiao/en/",
        apiUrl: "http://api.playtiao.com",
        isPackaged: false,
      }),
      false,
    );
  });
});

describe("selectCspPolicy", () => {
  test("returns the prod string in the default packaged case", () => {
    const policy = selectCspPolicy({
      startUrl: "app://tiao/en/",
      apiUrl: "https://api.playtiao.com",
      isPackaged: true,
    });
    assert.equal(policy, PROD_CONTENT_SECURITY_POLICY);
  });

  test("returns the dev string in dev:desktop mode", () => {
    const policy = selectCspPolicy({
      startUrl: "app://tiao/en/",
      apiUrl: "http://localhost:5250",
      isPackaged: false,
    });
    assert.equal(policy, DEV_CONTENT_SECURITY_POLICY);
  });
});

describe("policy strings", () => {
  test("prod policy blocks http: in connect-src (the regression path)", () => {
    // This is the exact scheme the dev:desktop bug tripped over: the
    // renderer tried to fetch http://localhost:5005/api/tournaments
    // under the prod CSP and got blocked. Assert explicitly so a
    // future edit to PROD_CONTENT_SECURITY_POLICY that accidentally
    // adds `http:` to connect-src fails this test loudly.
    const connectSrc = PROD_CONTENT_SECURITY_POLICY.split("; ").find((d) =>
      d.startsWith("connect-src"),
    );
    assert.ok(connectSrc, "prod CSP must have a connect-src directive");
    assert.ok(
      !/\bhttp:/.test(connectSrc),
      `prod connect-src must not permit http: — got '${connectSrc}'`,
    );
    assert.ok(
      /\bhttps:/.test(connectSrc),
      `prod connect-src must permit https: — got '${connectSrc}'`,
    );
  });

  test("dev policy permits http: and ws: in connect-src", () => {
    const connectSrc = DEV_CONTENT_SECURITY_POLICY.split("; ").find((d) =>
      d.startsWith("connect-src"),
    );
    assert.ok(connectSrc, "dev CSP must have a connect-src directive");
    assert.ok(
      /\bhttp:/.test(connectSrc),
      `dev connect-src must permit http: — got '${connectSrc}'`,
    );
    assert.ok(
      /\bws:/.test(connectSrc),
      `dev connect-src must permit ws: — got '${connectSrc}'`,
    );
  });
});
