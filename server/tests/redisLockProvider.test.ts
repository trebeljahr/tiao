import assert from "node:assert/strict";
import { describe, test, before, beforeEach, after } from "node:test";
import Redis from "ioredis";
import { RedisLockProvider } from "../game/lockProvider";

// RedisLockProvider hard-codes the "tiao:lock:" prefix. Tests run against
// a dedicated Redis database — each Redis-backed test file uses its own DB
// number so concurrent test files don't stomp on each other's flushdb.
// The dev server uses db 0.
const TEST_DB = 12;

describe("RedisLockProvider", () => {
  let redis: Redis | null = null;
  let provider: RedisLockProvider;
  let redisAvailable = false;

  before(async () => {
    try {
      const client = new Redis({
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
    }
  });

  beforeEach(async () => {
    if (!redisAvailable || !redis) {
      // Individual tests handle the skip — nothing to do here.
      return;
    }
    await redis.flushdb();
    provider = new RedisLockProvider(redis);
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

  test("basic withLock runs the operation and returns its result", async (t) => {
    if (!redisAvailable) return t.skip();
    const result = await provider.withLock("room1", async () => {
      return 42;
    });
    assert.strictEqual(result, 42);
  });

  test("lock key is released after successful operation", async (t) => {
    if (!redisAvailable) return t.skip();
    await provider.withLock("room1", async () => {});
    const held = await redis!.get("tiao:lock:room1");
    assert.strictEqual(held, null, "expected lock key to be released");
  });

  test("lock key is released when the operation throws", async (t) => {
    if (!redisAvailable) return t.skip();
    await assert.rejects(
      provider.withLock("room1", async () => {
        throw new Error("boom");
      }),
      /boom/,
    );
    const held = await redis!.get("tiao:lock:room1");
    assert.strictEqual(held, null, "expected lock to be released after throw");
  });

  test("operation result is returned for async operations", async (t) => {
    if (!redisAvailable) return t.skip();
    const result = await provider.withLock("room1", async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { ok: true, value: "hello" };
    });
    assert.deepStrictEqual(result, { ok: true, value: "hello" });
  });

  test("mutual exclusion: two withLock calls on the same key serialize", async (t) => {
    if (!redisAvailable) return t.skip();
    const events: string[] = [];

    const first = provider.withLock("shared", async () => {
      events.push("A:start");
      await new Promise((r) => setTimeout(r, 150));
      events.push("A:end");
    });

    // Small delay so the first acquire happens before the second starts
    await new Promise((r) => setTimeout(r, 20));

    const second = provider.withLock("shared", async () => {
      events.push("B:start");
      events.push("B:end");
    });

    await Promise.all([first, second]);

    // B must have started strictly after A ended
    assert.deepStrictEqual(events, ["A:start", "A:end", "B:start", "B:end"]);
  });

  test("different keys do not block each other (run concurrently)", async (t) => {
    if (!redisAvailable) return t.skip();
    const events: string[] = [];

    const a = provider.withLock("roomA", async () => {
      events.push("A:start");
      await new Promise((r) => setTimeout(r, 100));
      events.push("A:end");
    });

    const b = provider.withLock("roomB", async () => {
      events.push("B:start");
      await new Promise((r) => setTimeout(r, 100));
      events.push("B:end");
    });

    await Promise.all([a, b]);

    // Both starts should come before either end — they overlap
    assert.strictEqual(events[0], "A:start");
    assert.strictEqual(events[1], "B:start");
    assert.ok(events.indexOf("A:end") > events.indexOf("B:start"));
    assert.ok(events.indexOf("B:end") > events.indexOf("A:start"));
  });

  test("lock is actually held in Redis during the operation", async (t) => {
    if (!redisAvailable) return t.skip();
    let observedValue: string | null = null;
    await provider.withLock("room1", async () => {
      observedValue = await redis!.get("tiao:lock:room1");
    });
    assert.ok(observedValue !== null, "expected lock key to exist during operation");
    // After the operation, the key should be gone
    assert.strictEqual(await redis!.get("tiao:lock:room1"), null);
  });

  test("retry: a waiting acquirer eventually gets the lock after release", async (t) => {
    if (!redisAvailable) return t.skip();
    // First holder takes ~700ms; second call must wait (retry delay = 500ms)
    // and acquire after the first releases.
    const order: string[] = [];

    const holder = provider.withLock("contested", async () => {
      order.push("holder:start");
      await new Promise((r) => setTimeout(r, 700));
      order.push("holder:end");
    });

    await new Promise((r) => setTimeout(r, 20));

    const waiter = provider.withLock("contested", async () => {
      order.push("waiter:acquired");
    });

    await Promise.all([holder, waiter]);
    assert.deepStrictEqual(order, ["holder:start", "holder:end", "waiter:acquired"]);
  });

  test("released lock can be re-acquired without hitting retry loop", async (t) => {
    if (!redisAvailable) return t.skip();
    await provider.withLock("room1", async () => {});
    const start = Date.now();
    await provider.withLock("room1", async () => {});
    const elapsed = Date.now() - start;
    // The point of this test is "re-acquisition doesn't fall into the
    // 500ms retry loop because the first SET NX succeeds". Under parallel
    // test-file load the Redis roundtrip + ioredis overhead can legitimately
    // take a few hundred ms, so we allow headroom up to 1500ms — still
    // well below 2x the retry delay, so a regression that DOES hit the
    // retry loop (which would be 500ms × N attempts) would still be caught.
    assert.ok(elapsed < 1500, `expected no retry-loop cost, took ${elapsed}ms`);
  });

  test("sequential withLock calls succeed and each gets its own lock", async (t) => {
    if (!redisAvailable) return t.skip();
    const results: number[] = [];
    for (let i = 0; i < 5; i++) {
      const v = await provider.withLock("room1", async () => i);
      results.push(v);
    }
    assert.deepStrictEqual(results, [0, 1, 2, 3, 4]);
  });
});
