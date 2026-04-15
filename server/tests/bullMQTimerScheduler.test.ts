import assert from "node:assert/strict";
import { describe, test, before, beforeEach, afterEach, after } from "node:test";
import Redis from "ioredis";
import { BullMQTimerScheduler } from "../game/timerQueue";
import type { TimerHandlers } from "../game/timerQueue";

// BullMQTimerScheduler uses hard-coded queue names:
//   tiao-timer-clock, tiao-timer-abandon, tiao-timer-first-move
// These map to BullMQ Redis keys like "bull:tiao-timer-clock:*". Each
// Redis-backed test file runs against its own Redis database so concurrent
// test files don't stomp on each other's `flushdb`. The dev server uses
// db 0, and the BullMQ-dedicated db here is isolated from both.
const TEST_DB = 14;

// Short delay window so the tests run fast but still allow BullMQ's
// delayed-job scheduler to pick up the job. BullMQ Worker startup +
// delayed-set polling can add ~1s of latency on the first job, so the
// wait-for budget is deliberately generous.
const SHORT_DELAY_MS = 300;
const WAIT_FOR_FIRE_MS = 5000;

type Call = { type: string; roomId: string; extra?: string };

function createClient(): Redis {
  // Mirror production's shared-client settings (config/redisClient.ts):
  // maxRetriesPerRequest: 3. The scheduler internally calls duplicate({
  // maxRetriesPerRequest: null, enableReadyCheck: false }) for the Worker
  // connection, so passing the production-style client exercises the same
  // duplication path that crashed in production.
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
  return client;
}

async function waitFor(pred: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("BullMQTimerScheduler", () => {
  let redisAvailable = false;
  let redis: Redis | null = null;
  let scheduler: BullMQTimerScheduler | null = null;
  let calls: Call[] = [];
  let handlers: TimerHandlers;

  before(async () => {
    try {
      const client = createClient();
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
    // Wipe the isolated DB to remove any leftover BullMQ keys from prior runs.
    await redis.flushdb();
    calls = [];
    handlers = {
      onClockExpired: async (roomId, expectedTurn) => {
        calls.push({ type: "clock", roomId, extra: expectedTurn });
      },
      onAbandonExpired: async (roomId, playerId) => {
        calls.push({ type: "abandon", roomId, extra: playerId });
      },
      onFirstMoveExpired: async (roomId) => {
        calls.push({ type: "first-move", roomId });
      },
    };
    scheduler = new BullMQTimerScheduler(redis, handlers);
  });

  afterEach(async () => {
    if (scheduler) {
      await scheduler.close().catch(() => {});
      scheduler = null;
    }
    if (redis) {
      await redis.flushdb().catch(() => {});
    }
  });

  after(async () => {
    if (redis) {
      await redis.quit().catch(() => {});
      redis = null;
    }
  });

  test("isPersistent returns true", (t) => {
    if (!redisAvailable) return t.skip();
    assert.strictEqual(scheduler!.isPersistent(), true);
  });

  // ── Clock timer ────────────────────────────────────────────────────

  test("clock timer fires the handler after delayMs", async (t) => {
    if (!redisAvailable) return t.skip();
    await scheduler!.scheduleClockTimer("ROOM01", SHORT_DELAY_MS, "white");
    await waitFor(() => calls.length > 0, WAIT_FOR_FIRE_MS);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0]!.type, "clock");
    assert.strictEqual(calls[0]!.roomId, "ROOM01");
    assert.strictEqual(calls[0]!.extra, "white");
  });

  test("cancelClockTimer prevents firing", async (t) => {
    if (!redisAvailable) return t.skip();
    await scheduler!.scheduleClockTimer("ROOM01", SHORT_DELAY_MS, "white");
    await scheduler!.cancelClockTimer("ROOM01");
    // Wait well past the delay — handler should never fire
    await new Promise((r) => setTimeout(r, SHORT_DELAY_MS + 400));
    assert.strictEqual(calls.length, 0);
  });

  test("rescheduling clock timer replaces the old one", async (t) => {
    if (!redisAvailable) return t.skip();
    // Schedule with a long delay first
    await scheduler!.scheduleClockTimer("ROOM01", 30_000, "white");
    // Reschedule with a short delay and different expectedTurn
    await scheduler!.scheduleClockTimer("ROOM01", SHORT_DELAY_MS, "black");
    await waitFor(() => calls.length > 0, WAIT_FOR_FIRE_MS);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0]!.extra, "black");
    // Wait a bit to make sure the old one doesn't fire later
    await new Promise((r) => setTimeout(r, 300));
    assert.strictEqual(calls.length, 1);
  });

  test("clock timer for different rooms are independent", async (t) => {
    if (!redisAvailable) return t.skip();
    await scheduler!.scheduleClockTimer("R1", SHORT_DELAY_MS, "white");
    await scheduler!.scheduleClockTimer("R2", SHORT_DELAY_MS, "black");
    await waitFor(() => calls.length >= 2, WAIT_FOR_FIRE_MS);
    const rooms = calls.map((c) => c.roomId).sort();
    assert.deepStrictEqual(rooms, ["R1", "R2"]);
  });

  // ── Abandon timer ──────────────────────────────────────────────────

  test("abandon timer fires the handler after delayMs", async (t) => {
    if (!redisAvailable) return t.skip();
    await scheduler!.scheduleAbandonTimer("ROOM01", "player-1", SHORT_DELAY_MS);
    await waitFor(() => calls.length > 0, WAIT_FOR_FIRE_MS);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0]!.type, "abandon");
    assert.strictEqual(calls[0]!.roomId, "ROOM01");
    assert.strictEqual(calls[0]!.extra, "player-1");
  });

  test("cancelAbandonTimer prevents firing", async (t) => {
    if (!redisAvailable) return t.skip();
    await scheduler!.scheduleAbandonTimer("ROOM01", "player-1", SHORT_DELAY_MS);
    await scheduler!.cancelAbandonTimer("ROOM01", "player-1");
    await new Promise((r) => setTimeout(r, SHORT_DELAY_MS + 400));
    assert.strictEqual(calls.length, 0);
  });

  test("abandon timers for different players on same room are independent", async (t) => {
    if (!redisAvailable) return t.skip();
    await scheduler!.scheduleAbandonTimer("ROOM01", "p1", SHORT_DELAY_MS);
    await scheduler!.scheduleAbandonTimer("ROOM01", "p2", SHORT_DELAY_MS);
    await waitFor(() => calls.length >= 2, WAIT_FOR_FIRE_MS);
    const players = calls.map((c) => c.extra).sort();
    assert.deepStrictEqual(players, ["p1", "p2"]);
  });

  test("cancelling one abandon timer doesn't cancel another for the same room", async (t) => {
    if (!redisAvailable) return t.skip();
    await scheduler!.scheduleAbandonTimer("ROOM01", "p1", SHORT_DELAY_MS);
    await scheduler!.scheduleAbandonTimer("ROOM01", "p2", SHORT_DELAY_MS);
    await scheduler!.cancelAbandonTimer("ROOM01", "p1");
    await waitFor(() => calls.length > 0, WAIT_FOR_FIRE_MS);
    // Only p2 should fire
    await new Promise((r) => setTimeout(r, 200));
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0]!.extra, "p2");
  });

  // ── First-move timer ───────────────────────────────────────────────

  test("first-move timer fires the handler after delayMs", async (t) => {
    if (!redisAvailable) return t.skip();
    await scheduler!.scheduleFirstMoveTimer("ROOM01", SHORT_DELAY_MS);
    await waitFor(() => calls.length > 0, WAIT_FOR_FIRE_MS);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0]!.type, "first-move");
    assert.strictEqual(calls[0]!.roomId, "ROOM01");
  });

  test("cancelFirstMoveTimer prevents firing", async (t) => {
    if (!redisAvailable) return t.skip();
    await scheduler!.scheduleFirstMoveTimer("ROOM01", SHORT_DELAY_MS);
    await scheduler!.cancelFirstMoveTimer("ROOM01");
    await new Promise((r) => setTimeout(r, SHORT_DELAY_MS + 400));
    assert.strictEqual(calls.length, 0);
  });

  test("rescheduling first-move timer replaces the old one", async (t) => {
    if (!redisAvailable) return t.skip();
    await scheduler!.scheduleFirstMoveTimer("ROOM01", 30_000);
    await scheduler!.scheduleFirstMoveTimer("ROOM01", SHORT_DELAY_MS);
    await waitFor(() => calls.length > 0, WAIT_FOR_FIRE_MS);
    assert.strictEqual(calls.length, 1);
    // Make sure the original long-delay job doesn't fire later
    await new Promise((r) => setTimeout(r, 300));
    assert.strictEqual(calls.length, 1);
  });

  // ── jobId shape — regression for the `:` bug ───────────────────────

  test("jobIds contain no `:` (BullMQ forbids colons in job IDs)", async (t) => {
    if (!redisAvailable) return t.skip();
    // Schedule one of each timer type with a long delay so we can inspect
    // BullMQ's stored job keys before they fire.
    await scheduler!.scheduleClockTimer("ROOM01", 60_000, "white");
    await scheduler!.scheduleAbandonTimer("ROOM01", "player-1", 60_000);
    await scheduler!.scheduleFirstMoveTimer("ROOM01", 60_000);

    // BullMQ stores job data under keys of the form "bull:{queueName}:{jobId}"
    // alongside its own structural keys like ":meta", ":id", ":delayed",
    // ":events", ":stalled-check", etc. Assert that the specific jobIds
    // we expect exist AND that none of them contain a ':' character (the
    // character BullMQ's Lua scripts use as a key separator — the exact
    // bug that crashed production).
    const expectedKeys = [
      "bull:tiao-timer-clock:clock-ROOM01",
      "bull:tiao-timer-abandon:abandon-ROOM01-player-1",
      "bull:tiao-timer-first-move:first-move-ROOM01",
    ];
    for (const key of expectedKeys) {
      const exists = await redis!.exists(key);
      assert.strictEqual(exists, 1, `expected BullMQ job key "${key}" to exist`);
      const jobId = key.split(":").slice(2).join(":");
      // Sanity: the jobId portion should not contain a ':' — anything with
      // a colon in the jobId would not round-trip through "bull:q:jobId"
      // cleanly. Extract by splitting on the second ':' and check.
      const secondColon = key.indexOf(":", key.indexOf(":") + 1);
      const rawJobId = key.slice(secondColon + 1);
      assert.ok(
        !rawJobId.includes(":"),
        `jobId must not contain ':' — got "${rawJobId}" from key "${key}" (full: "${jobId}")`,
      );
    }
  });

  // ── close() ────────────────────────────────────────────────────────

  test("close() tears down workers and queues without throwing", async (t) => {
    if (!redisAvailable) return t.skip();
    await scheduler!.scheduleClockTimer("ROOM01", 60_000, "white");
    await scheduler!.close();
    // Mark as closed so afterEach doesn't double-close
    scheduler = null;
  });
});
