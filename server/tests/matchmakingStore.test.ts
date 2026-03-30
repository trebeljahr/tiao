import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { PlayerIdentity, TimeControl } from "../../shared/src";
import { InMemoryMatchmakingStore, type MatchmakingQueueEntry } from "../game/matchmakingStore";

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

describe("InMemoryMatchmakingStore", () => {
  // ── addToQueue + findEntry ──────────────────────────────────────────

  describe("addToQueue + findEntry", () => {
    test("returns the entry after adding", async () => {
      const store = new InMemoryMatchmakingStore();
      const e = entry("p1", 1500);
      await store.addToQueue(e);
      const found = await store.findEntry("p1");
      assert.deepStrictEqual(found, e);
    });

    test("returns null for a player not in queue", async () => {
      const store = new InMemoryMatchmakingStore();
      assert.strictEqual(await store.findEntry("nobody"), null);
    });

    test("can add multiple entries", async () => {
      const store = new InMemoryMatchmakingStore();
      await store.addToQueue(entry("p1", 1500));
      await store.addToQueue(entry("p2", 1600));
      assert.notStrictEqual(await store.findEntry("p1"), null);
      assert.notStrictEqual(await store.findEntry("p2"), null);
    });
  });

  // ── removeFromQueue ─────────────────────────────────────────────────

  describe("removeFromQueue", () => {
    test("removes an existing entry", async () => {
      const store = new InMemoryMatchmakingStore();
      await store.addToQueue(entry("p1", 1500));
      await store.removeFromQueue("p1");
      assert.strictEqual(await store.findEntry("p1"), null);
    });

    test("no-ops when player is not in queue", async () => {
      const store = new InMemoryMatchmakingStore();
      await store.addToQueue(entry("p1", 1500));
      await store.removeFromQueue("ghost");
      // p1 still present
      assert.notStrictEqual(await store.findEntry("p1"), null);
    });

    test("queue is empty after removing the only entry", async () => {
      const store = new InMemoryMatchmakingStore();
      await store.addToQueue(entry("p1", 1500));
      await store.removeFromQueue("p1");
      const all = await store.getAllEntries();
      assert.strictEqual(all.length, 0);
    });
  });

  // ── getAllEntries ───────────────────────────────────────────────────

  describe("getAllEntries", () => {
    test("returns empty array for fresh store", async () => {
      const store = new InMemoryMatchmakingStore();
      assert.deepStrictEqual(await store.getAllEntries(), []);
    });

    test("returns a copy, not the internal array", async () => {
      const store = new InMemoryMatchmakingStore();
      await store.addToQueue(entry("p1", 1500));
      const entries = await store.getAllEntries();
      entries.pop(); // mutate the returned array
      assert.strictEqual((await store.getAllEntries()).length, 1);
    });
  });

  // ── findAndRemoveOpponent: basic ───────────────────────────────────

  describe("findAndRemoveOpponent - basic", () => {
    test("finds and removes an eligible opponent", async () => {
      const store = new InMemoryMatchmakingStore();
      await store.addToQueue(entry("p1", 1500));
      const result = await store.findAndRemoveOpponent("p2", null, 1520);
      assert.strictEqual(result?.player.playerId, "p1");
      // p1 should be removed from the queue
      assert.strictEqual(await store.findEntry("p1"), null);
    });

    test("does not match with self", async () => {
      const store = new InMemoryMatchmakingStore();
      await store.addToQueue(entry("p1", 1500));
      const result = await store.findAndRemoveOpponent("p1", null, 1500);
      assert.strictEqual(result, null);
      // p1 should still be in queue
      assert.notStrictEqual(await store.findEntry("p1"), null);
    });

    test("returns null when queue is empty", async () => {
      const store = new InMemoryMatchmakingStore();
      const result = await store.findAndRemoveOpponent("p1", null, 1500);
      assert.strictEqual(result, null);
    });
  });

  // ── TimeControl matching ───────────────────────────────────────────

  describe("TimeControl matching", () => {
    test("null matches null", async () => {
      const store = new InMemoryMatchmakingStore();
      await store.addToQueue(entry("p1", 1500, null));
      const result = await store.findAndRemoveOpponent("p2", null, 1500);
      assert.strictEqual(result?.player.playerId, "p1");
    });

    test("null does not match non-null", async () => {
      const store = new InMemoryMatchmakingStore();
      const tc: TimeControl = { initialMs: 300000, incrementMs: 0 };
      await store.addToQueue(entry("p1", 1500, tc));
      const result = await store.findAndRemoveOpponent("p2", null, 1500);
      assert.strictEqual(result, null);
    });

    test("non-null does not match null", async () => {
      const store = new InMemoryMatchmakingStore();
      await store.addToQueue(entry("p1", 1500, null));
      const tc: TimeControl = { initialMs: 300000, incrementMs: 0 };
      const result = await store.findAndRemoveOpponent("p2", tc, 1500);
      assert.strictEqual(result, null);
    });

    test("same initialMs and incrementMs match", async () => {
      const store = new InMemoryMatchmakingStore();
      const tc: TimeControl = { initialMs: 600000, incrementMs: 5000 };
      await store.addToQueue(entry("p1", 1500, tc));
      const result = await store.findAndRemoveOpponent(
        "p2",
        { initialMs: 600000, incrementMs: 5000 },
        1500,
      );
      assert.strictEqual(result?.player.playerId, "p1");
    });

    test("different initialMs do not match", async () => {
      const store = new InMemoryMatchmakingStore();
      await store.addToQueue(entry("p1", 1500, { initialMs: 300000, incrementMs: 0 }));
      const result = await store.findAndRemoveOpponent(
        "p2",
        { initialMs: 600000, incrementMs: 0 },
        1500,
      );
      assert.strictEqual(result, null);
    });

    test("different incrementMs do not match", async () => {
      const store = new InMemoryMatchmakingStore();
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
    // BASE_WINDOW = 100, so <=100 Elo diff should match immediately
    test("matches within base window (100 Elo) when just queued", async () => {
      const store = new InMemoryMatchmakingStore();
      await store.addToQueue(entry("p1", 1500, null, Date.now()));
      const result = await store.findAndRemoveOpponent("p2", null, 1600);
      assert.strictEqual(result?.player.playerId, "p1");
    });

    test("does not match outside base window when just queued", async () => {
      const store = new InMemoryMatchmakingStore();
      await store.addToQueue(entry("p1", 1500, null, Date.now()));
      // 101 Elo diff should not match at base window
      const result = await store.findAndRemoveOpponent("p2", null, 1601);
      assert.strictEqual(result, null);
    });

    test("matches wider range after waiting (window expands 25/sec)", async () => {
      const store = new InMemoryMatchmakingStore();
      // Queued 4 seconds ago: window = 100 + 25*4 = 200
      const fourSecondsAgo = Date.now() - 4000;
      await store.addToQueue(entry("p1", 1500, null, fourSecondsAgo));
      const result = await store.findAndRemoveOpponent("p2", null, 1700);
      assert.strictEqual(result?.player.playerId, "p1");
    });

    test("does not match beyond expanded window", async () => {
      const store = new InMemoryMatchmakingStore();
      // Queued 4 seconds ago: window = 100 + 25*4 = 200
      const fourSecondsAgo = Date.now() - 4000;
      await store.addToQueue(entry("p1", 1500, null, fourSecondsAgo));
      // 201 Elo diff should not match
      const result = await store.findAndRemoveOpponent("p2", null, 1701);
      assert.strictEqual(result, null);
    });

    test("window is capped at MAX_WINDOW (1000)", async () => {
      const store = new InMemoryMatchmakingStore();
      // Queued 100 seconds ago: raw = 100 + 25*100 = 2600, but capped at 1000
      const longAgo = Date.now() - 100_000;
      await store.addToQueue(entry("p1", 1500, null, longAgo));
      // 1000 Elo diff should match at cap
      const result = await store.findAndRemoveOpponent("p2", null, 2500);
      assert.strictEqual(result?.player.playerId, "p1");
    });

    test("does not match beyond MAX_WINDOW even after long wait", async () => {
      const store = new InMemoryMatchmakingStore();
      const longAgo = Date.now() - 100_000;
      await store.addToQueue(entry("p1", 1500, null, longAgo));
      // 1001 Elo diff should not match even at cap
      const result = await store.findAndRemoveOpponent("p2", null, 2501);
      assert.strictEqual(result, null);
    });

    test("window is symmetric (lower-rated player queued)", async () => {
      const store = new InMemoryMatchmakingStore();
      await store.addToQueue(entry("p1", 1600, null, Date.now()));
      const result = await store.findAndRemoveOpponent("p2", null, 1500);
      assert.strictEqual(result?.player.playerId, "p1");
    });
  });

  // ── Best match selection ───────────────────────────────────────────

  describe("best match selection", () => {
    test("picks the closest Elo when multiple are eligible", async () => {
      const store = new InMemoryMatchmakingStore();
      await store.addToQueue(entry("far", 1400, null, Date.now()));
      await store.addToQueue(entry("close", 1490, null, Date.now()));
      await store.addToQueue(entry("mid", 1450, null, Date.now()));

      const result = await store.findAndRemoveOpponent("seeker", null, 1500);
      assert.strictEqual(result?.player.playerId, "close");
    });

    test("only removes the matched opponent, others remain", async () => {
      const store = new InMemoryMatchmakingStore();
      await store.addToQueue(entry("p1", 1400, null, Date.now()));
      await store.addToQueue(entry("p2", 1490, null, Date.now()));

      await store.findAndRemoveOpponent("seeker", null, 1500);
      // p1 should still be in queue, p2 was matched
      assert.notStrictEqual(await store.findEntry("p1"), null);
      assert.strictEqual(await store.findEntry("p2"), null);
    });
  });

  // ── Match tracking ─────────────────────────────────────────────────

  describe("match tracking (setMatch / getMatch / deleteMatch)", () => {
    test("setMatch then getMatch returns the game ID", async () => {
      const store = new InMemoryMatchmakingStore();
      await store.setMatch("p1", "game-abc");
      assert.strictEqual(await store.getMatch("p1"), "game-abc");
    });

    test("getMatch returns null when no match set", async () => {
      const store = new InMemoryMatchmakingStore();
      assert.strictEqual(await store.getMatch("p1"), null);
    });

    test("deleteMatch removes the tracked match", async () => {
      const store = new InMemoryMatchmakingStore();
      await store.setMatch("p1", "game-abc");
      await store.deleteMatch("p1");
      assert.strictEqual(await store.getMatch("p1"), null);
    });

    test("setMatch overwrites a previous match", async () => {
      const store = new InMemoryMatchmakingStore();
      await store.setMatch("p1", "game-1");
      await store.setMatch("p1", "game-2");
      assert.strictEqual(await store.getMatch("p1"), "game-2");
    });

    test("matches for different players are independent", async () => {
      const store = new InMemoryMatchmakingStore();
      await store.setMatch("p1", "game-a");
      await store.setMatch("p2", "game-b");
      assert.strictEqual(await store.getMatch("p1"), "game-a");
      assert.strictEqual(await store.getMatch("p2"), "game-b");
    });
  });
});
