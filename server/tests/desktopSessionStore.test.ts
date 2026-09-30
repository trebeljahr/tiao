import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { desktopSessionStore } from "../auth/desktopSessionStore";

test("security snapshot follows account changes and checks originating session on every read", async () => {
  const user: Record<string, unknown> = { email: "fake@example.invalid", emailVerified: true };
  const gameAccount = { isAdmin: false };
  const credential: Record<string, unknown> = {
    _id: "credential",
    providerId: "credential",
    accountId: "user",
    password: "fake-hash",
  };
  let present = true;
  let sessionPresent = true;
  const filters: Record<
    string,
    { _id?: unknown; userId?: unknown; expiresAt?: { $gt?: unknown } }
  > = {};
  const original = mongoose.connection.getClient;
  mongoose.connection.getClient = (() => ({
    db: () => ({
      collection: (name: string) => ({
        findOne: async (query: unknown) => {
          filters[name] = query as (typeof filters)[string];
          if (name === "session") return sessionPresent ? {} : null;
          if (name === "user") return user;
          if (name === "gameaccounts") return present ? gameAccount : null;
          throw new Error("Unexpected collection");
        },
        find: () => ({ toArray: async () => [credential] }),
      }),
    }),
  })) as unknown as typeof mongoose.connection.getClient;
  try {
    const initial = await desktopSessionStore.securityState("fake-user", "fake-browser");
    assert.ok(initial);
    assert.equal(filters.session._id, "fake-browser");
    assert.equal(filters.session.userId, "fake-user");
    assert.ok(filters.session.expiresAt?.$gt instanceof Date);
    credential.accessToken = "refreshed-oauth-token";
    assert.equal(await desktopSessionStore.securityState("fake-user", "fake-browser"), initial);
    for (const [object, field, value] of [
      [credential, "password", "new-fake-hash"],
      [credential, "providerId", "different-provider"],
      [user, "email", "new@example.invalid"],
      [user, "emailVerified", false],
      [gameAccount, "isAdmin", true],
    ] as const) {
      const record = object as Record<string, unknown>;
      const old = record[field];
      record[field] = value;
      assert.notEqual(
        await desktopSessionStore.securityState("fake-user", "fake-browser"),
        initial,
      );
      record[field] = old;
    }
    present = false;
    assert.equal(await desktopSessionStore.securityState("fake-user", "fake-browser"), null);
    present = true;
    sessionPresent = false;
    assert.equal(await desktopSessionStore.securityState("fake-user", "fake-browser"), null);
    sessionPresent = true;
    user.banned = true;
    assert.equal(await desktopSessionStore.securityState("fake-user", "fake-browser"), null);
  } finally {
    mongoose.connection.getClient = original;
  }
});
