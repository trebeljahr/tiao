import assert from "node:assert/strict";
import { test } from "node:test";
import { desktopSessionManager } from "../auth/desktopSessionManager";
import { fakeDesktopSessionStore } from "./fakeDesktopSessions";

function setup() {
  const fake = fakeDesktopSessionStore();
  let time = 1000;
  return {
    ...fake,
    manager: desktopSessionManager(fake.store, "fake-signing-key", () => time),
    advance: (days: number) => {
      time += days * 86400000;
    },
  };
}

test("durable records, signature, shape, expiry and duplicate-header checks", async () => {
  const { manager: m, rows, advance } = setup();
  const token = await m.createSessionToken("user", "browser-session");
  assert.equal((await m.verifySessionToken(token))?.userId, "user");
  assert.equal(await m.extractBearerUserId(`Bearer ${token}`), "user");
  assert.equal(await m.extractBearerUserId([`Bearer ${token}`]), null);
  for (const bad of [
    null,
    undefined,
    "",
    "v1.legacy.signature",
    token + ".extra",
    token.slice(0, -2) + "xx",
    "v2.e30.invalid",
  ]) {
    assert.equal(await m.verifySessionToken(bad), null);
  }
  advance(30);
  assert.equal(await m.verifySessionToken(token), null);
  advance(-30);
  rows.clear();
  assert.equal(await m.verifySessionToken(token), null);
});

test("refresh rotates once, retains family and cannot extend absolute lifetime", async () => {
  const { manager: m, advance } = setup();
  let token = await m.createSessionToken("user", "browser-session");
  const initial = await m.verifySessionToken(token);
  const attempts = await Promise.all([m.refreshSessionToken(token), m.refreshSessionToken(token)]);
  assert.equal(attempts.filter(Boolean).length, 1);
  assert.equal(await m.verifySessionToken(token), null);
  token = attempts.find(Boolean)!;
  assert.equal((await m.verifySessionToken(token))?.sessionId, initial?.sessionId);
  for (let i = 0; i < 4; i++) {
    advance(20);
    token = (await m.refreshSessionToken(token))!;
    assert.ok(token);
  }
  assert.equal((await m.verifySessionToken(token))?.expiresAt, 1000 + 90 * 86400000);
  advance(10);
  assert.equal(await m.refreshSessionToken(token), null);
});

test("logout revokes the whole family even when racing a refresh", async () => {
  const { manager: m } = setup();
  const old = await m.createSessionToken("user", "browser-session");
  const rotated = (await m.refreshSessionToken(old))!;
  await m.revokeSessionToken(old);
  assert.equal(await m.verifySessionToken(rotated), null);
  assert.equal(await m.refreshSessionToken(rotated), null);
  await m.revokeSessionToken(old); // Idempotent.
});

test("account security change or originating session revocation invalidates credentials", async () => {
  for (const state of [null, "changed-password-or-email-or-provider"]) {
    const { manager: m, setSecurityState } = setup();
    const token = await m.createSessionToken("user", "browser-session");
    setSecurityState(state);
    assert.equal(await m.verifySessionToken(token), null);
    setSecurityState("fake-security-state");
    assert.equal(await m.verifySessionToken(token), null); // Revocation stays permanent.
  }
});

test("storage failure fails closed and missing source session cannot mint credentials", async () => {
  const { manager: m, store, setSecurityState } = setup();
  await assert.rejects(m.createSessionToken("user", ""));
  const token = await m.createSessionToken("user", "browser-session");
  store.read = async () => {
    throw new Error("offline");
  };
  assert.equal(await m.verifySessionToken(token), null);
  setSecurityState(null);
  await assert.rejects(m.createSessionToken("user", "browser-session"));
});

test("an account change between OAuth callback and exchange cannot mint a new session", async () => {
  const { manager: m, setSecurityState } = setup();
  setSecurityState("new-password");
  await assert.rejects(m.createSessionToken("user", "browser-session", "fake-security-state"));
});
