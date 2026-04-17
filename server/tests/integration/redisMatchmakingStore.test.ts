import assert from "node:assert/strict";
import { describe, test, before, beforeEach, after } from "node:test";
import Redis from "ioredis";
import type { PlayerIdentity, TimeControl } from "../../../shared/src";
import { RedisMatchmakingStore, type MatchmakingQueueEntry } from "../../game/matchmakingStore";

// RedisMatchmakingStore hard-codes the key namespace ("tiao:matchmaking:*"),
// so we isolate from the running dev server by using a dedicated Redis
// database. Each Redis-backed test file uses its own DB number so concurrent
// test files don't stomp on each other's flushdb. The dev server uses db 0.
const TEST_DB = 11;

function createPlayer(id: string): PlayerIdentity {
  return { playerId: id, displayName: `Player ${id}`, kind: "guest" };
}

function entry(
  id: string,
  rating: number,
  timeControl: TimeControl = null,
  queuedAt: number = Date.now(),
): MatchmakingQueueEntry {
  return { player: createPlayer(id), queuedAt, timeControl, rating };
}

describe("RedisMatchmakingStore", () => {
  let redis: Redis | null = null;
  let store: RedisMatchmakingStore;
  let redisAvailable = false;

  before(async () => {
    let client: Redis | null = null;
    try {
      client = new Redis({
        host: "127.0.0.1",
        port: 6379,
        db: TEST_DB,
        maxRetriesPerRequest: 3,
        connectTimeout: 2000,
      });
      client.on("error", () => {
        /* swallow post-teardown errors */
      });
      await client.ping();
      redis = client;
      redisAvailable = true;
    } catch {
      redisAvailable = false;
      // Disconnect the orphan client so its reconnection loop doesn't
      // keep the event loop alive and hang the test process on exit.
      client?.disconnect();
    }
  });

  beforeEach(async () => {
    if (!redisAvailable || !redis) {
      // Individual tests handle the skip — nothing to do here.
      return;
    }
    await redis.flushdb();
    store = new RedisMatchmakingStore(redis);
  });

  after(async () => {
    if (redis) {
      try {
        await redis.flushdb();
      } catch {
        /* ignore */
      }
      await redis.quit().catch(() => {});
      redis = null;
    }
  });

  // ── addToQueue + findEntry ──────────────────────────────────────────

  describe("addToQueue + findEntry", () => {
    test("returns the entry after adding", async (t) => {
      if (!redisAvailable) return t.skip();
      const e = entry("p1", 1500);
      await store.addToQueue(e);
      const found = await store.findEntry("p1");
      assert.deepStrictEqual(found, e);
    });

    test("returns null for a player not in queue", async (t) => {
      if (!redisAvailable) return t.skip();
      assert.strictEqual(await store.findEntry("nobody"), null);
    });

    test("can add multiple entries", async (t) => {
      if (!redisAvailable) return t.skip();
      await store.addToQueue(entry("p1", 1500));
      await store.addToQueue(entry("p2", 1600));
      assert.notStrictEqual(await store.findEntry("p1"), null);
      assert.notStrictEqual(await store.findEntry("p2"), null);
    });
  });

  // ── removeFromQueue ─────────────────────────────────────────────────

  describe("removeFromQueue", () => {
    test("removes an existing entry", async (t) => {
      if (!redisAvailable) return t.skip();
      await store.addToQueue(entry("p1", 1500));
      await store.removeFromQueue("p1");
      assert.strictEqual(await store.findEntry("p1"), null);
    });

    test("no-ops when player is not in queue", async (t) => {
      if (!redisAvailable) return t.skip();
      await store.addToQueue(entry("p1", 1500));
      await store.removeFromQueue("ghost");
      assert.notStrictEqual(await store.findEntry("p1"), null);
    });

    test("queue is empty after removing the only entry", async (t) => {
      if (!redisAvailable) return t.skip();
      await store.addToQueue(entry("p1", 1500));
      await store.removeFromQueue("p1");
      const all = await store.getAllEntries();
      assert.strictEqual(all.length, 0);
    });
  });

  // ── getAllEntries ───────────────────────────────────────────────────

  describe("getAllEntries", () => {
    test("returns empty array for fresh store", async (t) => {
      if (!redisAvailable) return t.skip();
      assert.deepStrictEqual(await store.getAllEntries(), []);
    });

    test("returns all queued entries", async (t) => {
      if (!redisAvailable) return t.skip();
      // Stagger queuedAt so the sorted-set ordering is deterministic
      await store.addToQueue(entry("p1", 1500, null, Date.now() - 2000));
      await store.addToQueue(entry("p2", 1600, null, Date.now() - 1000));
      const all = await store.getAllEntries();
      assert.strictEqual(all.length, 2);
      const ids = all.map((e) => e.player.playerId).sort();
      assert.deepStrictEqual(ids, ["p1", "p2"]);
    });
  });

  // ── findAndRemoveOpponent: basic ───────────────────────────────────

  describe("findAndRemoveOpponent - basic", () => {
    test("finds and removes an eligible opponent", async (t) => {
      if (!redisAvailable) return t.skip();
      await store.addToQueue(entry("p1", 1500));
      const result = await store.findAndRemoveOpponent("p2", null, 1520);
      assert.strictEqual(result?.player.playerId, "p1");
      assert.strictEqual(await store.findEntry("p1"), null);
    });

    test("does not match with self", async (t) => {
      if (!redisAvailable) return t.skip();
      await store.addToQueue(entry("p1", 1500));
      const result = await store.findAndRemoveOpponent("p1", null, 1500);
      assert.strictEqual(result, null);
      assert.notStrictEqual(await store.findEntry("p1"), null);
    });

    test("returns null when queue is empty", async (t) => {
      if (!redisAvailable) return t.skip();
      const result = await store.findAndRemoveOpponent("p1", null, 1500);
      assert.strictEqual(result, null);
    });
  });

  // ── TimeControl matching ───────────────────────────────────────────

  describe("TimeControl matching", () => {
    test("null matches null", async (t) => {
      if (!redisAvailable) return t.skip();
      await store.addToQueue(entry("p1", 1500, null));
      const result = await store.findAndRemoveOpponent("p2", null, 1500);
      assert.strictEqual(result?.player.playerId, "p1");
    });

    test("null does not match non-null", async (t) => {
      if (!redisAvailable) return t.skip();
      const tc: TimeControl = { initialMs: 300000, incrementMs: 0 };
      await store.addToQueue(entry("p1", 1500, tc));
      const result = await store.findAndRemoveOpponent("p2", null, 1500);
      assert.strictEqual(result, null);
    });

    test("non-null does not match null", async (t) => {
      if (!redisAvailable) return t.skip();
      await store.addToQueue(entry("p1", 1500, null));
      const tc: TimeControl = { initialMs: 300000, incrementMs: 0 };
      const result = await store.findAndRemoveOpponent("p2", tc, 1500);
      assert.strictEqual(result, null);
    });

    test("same initialMs and incrementMs match", async (t) => {
      if (!redisAvailable) return t.skip();
      const tc: TimeControl = { initialMs: 600000, incrementMs: 5000 };
      await store.addToQueue(entry("p1", 1500, tc));
      const result = await store.findAndRemoveOpponent(
        "p2",
        { initialMs: 600000, incrementMs: 5000 },
        1500,
      );
      assert.strictEqual(result?.player.playerId, "p1");
    });

    test("different initialMs do not match", async (t) => {
      if (!redisAvailable) return t.skip();
      await store.addToQueue(entry("p1", 1500, { initialMs: 300000, incrementMs: 0 }));
      const result = await store.findAndRemoveOpponent(
        "p2",
        { initialMs: 600000, incrementMs: 0 },
        1500,
      );
      assert.strictEqual(result, null);
    });

    test("different incrementMs do not match", async (t) => {
      if (!redisAvailable) return t.skip();
      await store.addToQueue(entry("p1", 1500, { initialMs: 300000, incrementMs: 0 }));
      const result = await store.findAndRemoveOpponent(
        "p2",
        { initialMs: 300000, incrementMs: 5000 },
        1500,
      );
      assert.strictEqual(result, null);
    });
  });

  // ── Elo window expansion ───────────────────────────────────────────

  describe("Elo window expansion", () => {
    test("matches within base window (100 Elo) when just queued", async (t) => {
      if (!redisAvailable) return t.skip();
      await store.addToQueue(entry("p1", 1500, null, Date.now()));
      const result = await store.findAndRemoveOpponent("p2", null, 1600);
      assert.strictEqual(result?.player.playerId, "p1");
    });

    test("does not match outside base window when just queued", async (t) => {
      if (!redisAvailable) return t.skip();
      await store.addToQueue(entry("p1", 1500, null, Date.now()));
      const result = await store.findAndRemoveOpponent("p2", null, 1601);
      assert.strictEqual(result, null);
    });

    test("matches wider range after waiting (window expands 25/sec)", async (t) => {
      if (!redisAvailable) return t.skip();
      // Queued 4 seconds ago: window = 100 + 25*4 = 200
      const fourSecondsAgo = Date.now() - 4000;
      await store.addToQueue(entry("p1", 1500, null, fourSecondsAgo));
      const result = await store.findAndRemoveOpponent("p2", null, 1700);
      assert.strictEqual(result?.player.playerId, "p1");
    });

    test("does not match beyond expanded window", async (t) => {
      if (!redisAvailable) return t.skip();
      const fourSecondsAgo = Date.now() - 4000;
      await store.addToQueue(entry("p1", 1500, null, fourSecondsAgo));
      const result = await store.findAndRemoveOpponent("p2", null, 1701);
      assert.strictEqual(result, null);
    });

    test("window is capped at MAX_WINDOW (1000)", async (t) => {
      if (!redisAvailable) return t.skip();
      // Queued 100 seconds ago: raw = 100 + 25*100 = 2600, capped at 1000
      const longAgo = Date.now() - 100_000;
      await store.addToQueue(entry("p1", 1500, null, longAgo));
      const result = await store.findAndRemoveOpponent("p2", null, 2500);
      assert.strictEqual(result?.player.playerId, "p1");
    });

    test("does not match beyond MAX_WINDOW even after long wait", async (t) => {
      if (!redisAvailable) return t.skip();
      const longAgo = Date.now() - 100_000;
      await store.addToQueue(entry("p1", 1500, null, longAgo));
      const result = await store.findAndRemoveOpponent("p2", null, 2501);
      assert.strictEqual(result, null);
    });

    test("window is symmetric (lower-rated player queued)", async (t) => {
      if (!redisAvailable) return t.skip();
      await store.addToQueue(entry("p1", 1600, null, Date.now()));
      const result = await store.findAndRemoveOpponent("p2", null, 1500);
      assert.strictEqual(result?.player.playerId, "p1");
    });
  });

  // ── Best match selection ───────────────────────────────────────────

  describe("best match selection", () => {
    test("picks the closest Elo when multiple are eligible", async (t) => {
      if (!redisAvailable) return t.skip();
      // Stagger queuedAt so the sorted-set iteration order is stable.
      const now = Date.now();
      await store.addToQueue(entry("far", 1400, null, now - 300));
      await store.addToQueue(entry("close", 1490, null, now - 200));
      await store.addToQueue(entry("mid", 1450, null, now - 100));

      const result = await store.findAndRemoveOpponent("seeker", null, 1500);
      assert.strictEqual(result?.player.playerId, "close");
    });

    test("only removes the matched opponent, others remain", async (t) => {
      if (!redisAvailable) return t.skip();
      const now = Date.now();
      await store.addToQueue(entry("p1", 1400, null, now - 200));
      await store.addToQueue(entry("p2", 1490, null, now - 100));

      await store.findAndRemoveOpponent("seeker", null, 1500);
      assert.notStrictEqual(await store.findEntry("p1"), null);
      assert.strictEqual(await store.findEntry("p2"), null);
    });
  });

  // ── Match tracking ─────────────────────────────────────────────────

  describe("match tracking (setMatch / getMatch / deleteMatch)", () => {
    test("setMatch then getMatch returns the game ID", async (t) => {
      if (!redisAvailable) return t.skip();
      await store.setMatch("p1", "game-abc");
      assert.strictEqual(await store.getMatch("p1"), "game-abc");
    });

    test("getMatch returns null when no match set", async (t) => {
      if (!redisAvailable) return t.skip();
      assert.strictEqual(await store.getMatch("p1"), null);
    });

    test("deleteMatch removes the tracked match", async (t) => {
      if (!redisAvailable) return t.skip();
      await store.setMatch("p1", "game-abc");
      await store.deleteMatch("p1");
      assert.strictEqual(await store.getMatch("p1"), null);
    });

    test("setMatch overwrites a previous match", async (t) => {
      if (!redisAvailable) return t.skip();
      await store.setMatch("p1", "game-1");
      await store.setMatch("p1", "game-2");
      assert.strictEqual(await store.getMatch("p1"), "game-2");
    });

    test("matches for different players are independent", async (t) => {
      if (!redisAvailable) return t.skip();
      await store.setMatch("p1", "game-a");
      await store.setMatch("p2", "game-b");
      assert.strictEqual(await store.getMatch("p1"), "game-a");
      assert.strictEqual(await store.getMatch("p2"), "game-b");
    });

    test("setMatch writes with TTL so keys eventually expire", async (t) => {
      if (!redisAvailable) return t.skip();
      await store.setMatch("p1", "game-abc");
      // Production writes with EX 300. Verify a positive TTL was set.
      const ttl = await redis!.ttl("tiao:matchmaking:match:p1");
      assert.ok(ttl > 0 && ttl <= 300, `expected 0<ttl<=300, got ${ttl}`);
    });
  });
});
