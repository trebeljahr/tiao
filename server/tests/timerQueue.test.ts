import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, mock, test } from "node:test";
import { InMemoryTimerScheduler } from "../game/timerQueue";
import type { TimerHandlers } from "../game/timerQueue";

describe("InMemoryTimerScheduler", () => {
  let scheduler: InMemoryTimerScheduler;
  let calls: Array<{ type: string; roomId: string; extra?: string }>;
  let handlers: TimerHandlers;

  beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout"] });
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
    scheduler = new InMemoryTimerScheduler(handlers);
  });

  afterEach(async () => {
    await scheduler.close();
    mock.timers.reset();
  });

  test("clock timer fires after delay", async () => {
    await scheduler.scheduleClockTimer("ROOM01", 5000, "white");
    assert.equal(calls.length, 0);
    mock.timers.tick(5000);
    // Allow microtask to resolve
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.type, "clock");
    assert.equal(calls[0]!.roomId, "ROOM01");
    assert.equal(calls[0]!.extra, "white");
  });

  test("clock timer cancel prevents firing", async () => {
    await scheduler.scheduleClockTimer("ROOM01", 5000, "white");
    await scheduler.cancelClockTimer("ROOM01");
    mock.timers.tick(10000);
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.length, 0);
  });

  test("rescheduling clock timer cancels previous", async () => {
    await scheduler.scheduleClockTimer("ROOM01", 5000, "white");
    await scheduler.scheduleClockTimer("ROOM01", 3000, "black");
    mock.timers.tick(3000);
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.extra, "black");
    // Old timer should not fire
    mock.timers.tick(5000);
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.length, 1);
  });

  test("abandon timer fires after delay", async () => {
    await scheduler.scheduleAbandonTimer("ROOM01", "player-1", 300_000);
    mock.timers.tick(300_000);
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.type, "abandon");
    assert.equal(calls[0]!.extra, "player-1");
  });

  test("abandon timer cancel prevents firing", async () => {
    await scheduler.scheduleAbandonTimer("ROOM01", "player-1", 300_000);
    await scheduler.cancelAbandonTimer("ROOM01", "player-1");
    mock.timers.tick(300_000);
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.length, 0);
  });

  test("duplicate abandon schedule is ignored", async () => {
    await scheduler.scheduleAbandonTimer("ROOM01", "player-1", 300_000);
    await scheduler.scheduleAbandonTimer("ROOM01", "player-1", 100_000);
    // Only the first timer exists; second was ignored
    mock.timers.tick(100_000);
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.length, 0);
    mock.timers.tick(200_000);
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.length, 1);
  });

  test("first-move timer fires after delay", async () => {
    await scheduler.scheduleFirstMoveTimer("ROOM01", 30_000);
    mock.timers.tick(30_000);
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.type, "first-move");
    assert.equal(calls[0]!.roomId, "ROOM01");
  });

  test("first-move timer cancel prevents firing", async () => {
    await scheduler.scheduleFirstMoveTimer("ROOM01", 30_000);
    await scheduler.cancelFirstMoveTimer("ROOM01");
    mock.timers.tick(30_000);
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.length, 0);
  });

  test("isPersistent returns false", () => {
    assert.equal(scheduler.isPersistent(), false);
  });

  test("close cancels all timers", async () => {
    await scheduler.scheduleClockTimer("R1", 5000, "white");
    await scheduler.scheduleAbandonTimer("R2", "p1", 5000);
    await scheduler.scheduleFirstMoveTimer("R3", 5000);
    await scheduler.close();
    mock.timers.tick(10000);
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.length, 0);
  });

  test("independent rooms have independent timers", async () => {
    await scheduler.scheduleClockTimer("R1", 3000, "white");
    await scheduler.scheduleClockTimer("R2", 5000, "black");
    mock.timers.tick(3000);
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.roomId, "R1");
    mock.timers.tick(2000);
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.length, 2);
    assert.equal(calls[1]!.roomId, "R2");
  });
});
