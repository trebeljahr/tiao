import assert from "node:assert/strict";
import { test } from "node:test";
import type Redis from "ioredis";
import { RedisRoomPresence } from "../game/presence";

test("presence shutdown waits for a delayed renewal before deleting its member", async () => {
  const members = new Set<string>();
  let calls = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reached!: () => void;
  const renewalStarted = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const redis = {
    status: "ready",
    async eval(_script: string, _count: number, _key: string, member: string) {
      if (++calls > 1) {
        reached();
        await held;
      }
      members.add(member);
      return 1;
    },
    async zrem(_key: string, member: string) {
      members.delete(member);
      return 1;
    },
  } as unknown as Redis;
  const presence = new RedisRoomPresence(redis, 60);
  // Keep the test alive while the production interval is unref'ed.
  const keepAlive = setTimeout(() => undefined, 2000);
  try {
    await presence.join("socket", "room", {
      playerId: "guest",
      displayName: "Guest",
      kind: "guest",
    });
    await renewalStarted;
    let closed = false;
    const closing = presence.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    assert.equal(closed, false);
    assert.equal(presence.isReady(), false);
    release();
    await closing;
    assert.equal(members.size, 0);
  } finally {
    release();
    await presence.close();
    clearTimeout(keepAlive);
  }
});
