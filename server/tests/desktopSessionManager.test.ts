import assert from "node:assert/strict";
import { describe, test } from "node:test";

// ---------------------------------------------------------------------------
// Environment variables required before importing any server modules.
// desktopSessionManager pulls TOKEN_SECRET from config/envVars, which
// exits the process if the var is missing.
// ---------------------------------------------------------------------------
process.env.TOKEN_SECRET ??= "test-token-secret";
process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/tiao-test";
process.env.S3_BUCKET_NAME ??= "tiao-test-assets";
process.env.S3_PUBLIC_URL ??= "https://assets.test.local";

import {
  createSessionToken,
  extractBearerUserId,
  verifySessionToken,
} from "../auth/desktopSessionManager";

describe("createSessionToken", () => {
  test("returns a v1.<payload>.<sig> formatted token", () => {
    const token = createSessionToken("user-1");
    const parts = token.split(".");
    assert.equal(parts.length, 3);
    assert.equal(parts[0], "v1");
    assert.ok(parts[1].length > 0);
    assert.ok(parts[2].length > 0);
  });

  test("two tokens for the same userId in the same ms are still unique (nonce)", () => {
    const a = createSessionToken("user-1");
    const b = createSessionToken("user-1");
    assert.notEqual(a, b);
  });

  test("throws when userId is empty", () => {
    assert.throws(() => createSessionToken(""));
  });

  test("throws when ttlDays is zero or negative", () => {
    assert.throws(() => createSessionToken("user-1", 0));
    assert.throws(() => createSessionToken("user-1", -5));
  });
});

describe("verifySessionToken", () => {
  test("returns the payload for a freshly-minted valid token", () => {
    const token = createSessionToken("user-42", 30);
    const payload = verifySessionToken(token);
    assert.ok(payload);
    assert.equal(payload.userId, "user-42");
    assert.ok(payload.expiresAt > Date.now());
    assert.ok(payload.nonce.length > 0);
  });

  test("returns null for null / undefined / empty input", () => {
    assert.equal(verifySessionToken(null), null);
    assert.equal(verifySessionToken(undefined), null);
    assert.equal(verifySessionToken(""), null);
  });

  test("returns null for malformed tokens (wrong part count)", () => {
    assert.equal(verifySessionToken("notatoken"), null);
    assert.equal(verifySessionToken("v1.only-two-parts"), null);
    assert.equal(verifySessionToken("v1.a.b.c.d"), null);
  });

  test("returns null when the version prefix is not v1", () => {
    const token = createSessionToken("user-1");
    const parts = token.split(".");
    const wrongVersion = `v2.${parts[1]}.${parts[2]}`;
    assert.equal(verifySessionToken(wrongVersion), null);
  });

  test("returns null when the signature is tampered with", () => {
    const token = createSessionToken("user-1");
    const parts = token.split(".");
    // Flip the first character of the signature to anything else.
    const tamperedSig = (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1);
    const tampered = `${parts[0]}.${parts[1]}.${tamperedSig}`;
    assert.equal(verifySessionToken(tampered), null);
  });

  test("returns null when the payload is tampered with (userId swapped)", () => {
    const original = createSessionToken("user-1");
    const parts = original.split(".");
    // Replace the payload with a synthetic one claiming a different
    // userId — the signature no longer matches.
    const fakePayload = Buffer.from(
      JSON.stringify({
        userId: "attacker",
        expiresAt: Date.now() + 86400000,
        nonce: "fake",
      }),
      "utf8",
    ).toString("base64url");
    const tampered = `${parts[0]}.${fakePayload}.${parts[2]}`;
    assert.equal(verifySessionToken(tampered), null);
  });

  test("returns null when the token has expired", () => {
    // ttlDays = 0.001 → expires in ~86 seconds; subtract more than that
    // by fast-forwarding Date.now via a fresh token that's immediately
    // in the past.  We can't call createSessionToken with a negative
    // ttl (it throws), so instead we roll our own in-line.
    const crypto = require("node:crypto");
    const TOKEN_SECRET = process.env.TOKEN_SECRET;
    const payload = {
      userId: "user-past",
      expiresAt: Date.now() - 1000, // 1 second ago
      nonce: "test-nonce",
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const sig = crypto.createHmac("sha256", TOKEN_SECRET).update(payloadB64).digest("base64url");
    const expiredToken = `v1.${payloadB64}.${sig}`;
    assert.equal(verifySessionToken(expiredToken), null);
  });

  test("returns null when the payload JSON is malformed", () => {
    const crypto = require("node:crypto");
    const TOKEN_SECRET = process.env.TOKEN_SECRET;
    const badJsonB64 = Buffer.from("not json at all", "utf8").toString("base64url");
    const sig = crypto.createHmac("sha256", TOKEN_SECRET).update(badJsonB64).digest("base64url");
    const badToken = `v1.${badJsonB64}.${sig}`;
    assert.equal(verifySessionToken(badToken), null);
  });

  test("returns null when the payload is missing required fields", () => {
    const crypto = require("node:crypto");
    const TOKEN_SECRET = process.env.TOKEN_SECRET;
    const incomplete = Buffer.from(JSON.stringify({ userId: "u" }), "utf8").toString("base64url");
    const sig = crypto.createHmac("sha256", TOKEN_SECRET).update(incomplete).digest("base64url");
    const badToken = `v1.${incomplete}.${sig}`;
    assert.equal(verifySessionToken(badToken), null);
  });
});

describe("extractBearerUserId", () => {
  test("returns the userId for a valid Bearer header", () => {
    const token = createSessionToken("user-99");
    const header = `Bearer ${token}`;
    assert.equal(extractBearerUserId(header), "user-99");
  });

  test("returns null for a missing header", () => {
    assert.equal(extractBearerUserId(undefined), null);
    assert.equal(extractBearerUserId(""), null);
  });

  test("returns null for a non-Bearer scheme", () => {
    const token = createSessionToken("user-1");
    assert.equal(extractBearerUserId(`Basic ${token}`), null);
  });

  test("returns null for case-mismatched scheme (Bearer is case-sensitive per RFC 6750)", () => {
    const token = createSessionToken("user-1");
    assert.equal(extractBearerUserId(`bearer ${token}`), null);
    assert.equal(extractBearerUserId(`BEARER ${token}`), null);
  });

  test("returns null for an invalid token", () => {
    assert.equal(extractBearerUserId("Bearer notatoken"), null);
    assert.equal(extractBearerUserId("Bearer "), null);
  });

  test("takes the first value when the header is an array (duplicate header)", () => {
    const token = createSessionToken("user-77");
    assert.equal(extractBearerUserId([`Bearer ${token}`, "Bearer other"]), "user-77");
  });

  test("returns null for an expired token via bearer header", () => {
    const crypto = require("node:crypto");
    const TOKEN_SECRET = process.env.TOKEN_SECRET;
    const payload = {
      userId: "stale",
      expiresAt: Date.now() - 60_000,
      nonce: "n",
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const sig = crypto.createHmac("sha256", TOKEN_SECRET).update(payloadB64).digest("base64url");
    const expired = `v1.${payloadB64}.${sig}`;
    assert.equal(extractBearerUserId(`Bearer ${expired}`), null);
  });
});
