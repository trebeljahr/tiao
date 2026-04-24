import assert from "node:assert/strict";
import { describe, test } from "node:test";

// ---------------------------------------------------------------------------
// wsOrigin pulls FRONTEND_URL at module load time from envVars, so set
// it before importing.  Unit tests run in isolation and don't care
// about the real production URL.
// ---------------------------------------------------------------------------
process.env.FRONTEND_URL = "https://playtiao.com";
process.env.TOKEN_SECRET ??= "test-token-secret";
process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/tiao-test";
process.env.S3_BUCKET_NAME ??= "tiao-test-assets";
process.env.S3_PUBLIC_URL ??= "https://assets.test.local";

import { DESKTOP_ORIGIN, isAllowedOrigin } from "../lib/wsOrigin";

describe("isAllowedOrigin — web origin rules (unchanged)", () => {
  test("matches the configured FRONTEND_URL origin", () => {
    assert.equal(isAllowedOrigin("https://playtiao.com"), true);
  });

  test("rejects a completely different origin", () => {
    assert.equal(isAllowedOrigin("https://attacker.com"), false);
  });

  test("rejects a missing origin when no token is present", () => {
    assert.equal(isAllowedOrigin(undefined), false);
    assert.equal(isAllowedOrigin(""), false);
  });

  test("rejects malformed origin strings", () => {
    assert.equal(isAllowedOrigin("not-a-url"), false);
  });

  test("matches a path underneath FRONTEND_URL (URL() strips path)", () => {
    assert.equal(isAllowedOrigin("https://playtiao.com/somewhere"), true);
  });
});

describe("isAllowedOrigin — desktop token exception", () => {
  test("accepts app://tiao when a valid desktop token is present", () => {
    assert.equal(isAllowedOrigin(DESKTOP_ORIGIN, { hasValidDesktopToken: true }), true);
  });

  test("accepts a missing origin when a valid desktop token is present", () => {
    assert.equal(isAllowedOrigin(undefined, { hasValidDesktopToken: true }), true);
    assert.equal(isAllowedOrigin("", { hasValidDesktopToken: true }), true);
  });

  test("rejects app://tiao WITHOUT a valid desktop token", () => {
    assert.equal(isAllowedOrigin(DESKTOP_ORIGIN), false);
    assert.equal(isAllowedOrigin(DESKTOP_ORIGIN, { hasValidDesktopToken: false }), false);
  });

  test("rejects attacker.com even with a valid desktop token (origin is still checked)", () => {
    assert.equal(isAllowedOrigin("https://attacker.com", { hasValidDesktopToken: true }), false);
  });

  test("rejects a random app:// scheme with a token", () => {
    assert.equal(isAllowedOrigin("app://other-app", { hasValidDesktopToken: true }), false);
  });

  test("web origins still work when the desktop token flag is set", () => {
    // A user who has BOTH a token and a normal web session — allow.
    assert.equal(isAllowedOrigin("https://playtiao.com", { hasValidDesktopToken: true }), true);
  });
});
