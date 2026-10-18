import assert from "node:assert/strict";
import { after, before, beforeEach, describe, type TestContext, test } from "node:test";
import type { CommandSucceededEvent } from "mongodb";
import mongoose from "mongoose";
import {
  type CompactHistory,
  compactToHistory,
  confirmPendingJump,
  createInitialGameState,
  type GameState,
  jumpPiece,
  placePiece,
  type RuleResult,
  type TurnRecord,
  undoLastTurn,
} from "../../../shared/src";
import { MongoGameRoomStore, type StoredMultiplayerRoom } from "../../game/gameStore";
import GameRoom from "../../models/GameRoom";

// Runs against a local mongod in a throwaway database; skips without one.
const MONGODB_URI = process.env.MONGODB_TEST_URI ?? "mongodb://127.0.0.1:27017";
const DB_NAME = `tiao_test_room_store_${process.pid}`;

type RawRoom = { revision: number; moveHistory: CompactHistory | null };

function stripTimestamps(history: TurnRecord[]): TurnRecord[] {
  return history.map((record) => {
    if (record.type !== "put" && record.type !== "jump") return record;
    const { timestamp: _timestamp, ...rest } = record;
    return rest as TurnRecord;
  });
}

function unwrap(result: RuleResult<GameState>): GameState {
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

/** Mirrors gameService.applyAction: stamp the records a rule step just added. */
function stamp(before: GameState, after: GameState, now: number): GameState {
  for (let i = before.history.length; i < after.history.length; i++) {
    const record = after.history[i];
    if (record.type === "put" || record.type === "jump") record.timestamp = now;
  }
  return after;
}

describe("MongoGameRoomStore move history", () => {
  let mongoAvailable = false;
  let store: MongoGameRoomStore;

  before(async () => {
    try {
      await mongoose.connect(MONGODB_URI, {
        dbName: DB_NAME,
        serverSelectionTimeoutMS: 2000,
        monitorCommands: true,
      });
      mongoAvailable = true;
    } catch {
      mongoAvailable = false;
      await mongoose.disconnect().catch(() => {});
    }
  });

  beforeEach(async () => {
    if (!mongoAvailable) return;
    await GameRoom.deleteMany({});
    store = new MongoGameRoomStore();
  });

  after(async () => {
    if (!mongoAvailable) return;
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
  });

  async function createRoom(id: string): Promise<StoredMultiplayerRoom> {
    return store.createRoom({
      id,
      roomType: "direct",
      status: "active",
      state: createInitialGameState(),
      rematch: null,
      takeback: null,
      seats: {
        white: { playerId: "white-player", displayName: "White", kind: "account" },
        black: { playerId: "black-player", displayName: "Black", kind: "account" },
      },
      timeControl: null,
      clockMs: null,
      lastMoveAt: null,
      firstMoveDeadline: null,
    });
  }

  async function raw(id: string): Promise<RawRoom> {
    const doc = await GameRoom.findOne({ roomId: id }).lean<RawRoom>().exec();
    assert.ok(doc);
    return doc;
  }

  /** getRoom → rule step → saveRoom, as one websocket action does. */
  async function play(
    id: string,
    step: (state: GameState) => RuleResult<GameState>,
    now: number,
    on: MongoGameRoomStore = store,
  ): Promise<StoredMultiplayerRoom> {
    const room = await on.getRoom(id);
    assert.ok(room);
    const state = stamp(room.state, unwrap(step(room.state)), now);
    return on.saveRoom({ ...room, state });
  }

  /** For each room document MongoDB returns from now on: did it carry moveHistory? */
  function watchHistoryReads(t: TestContext): boolean[] {
    const reads: boolean[] = [];
    const client = mongoose.connection.getClient();
    const listener = (event: CommandSucceededEvent) => {
      if (event.commandName !== "find" && event.commandName !== "aggregate") return;
      const reply = event.reply as { cursor?: { firstBatch?: Record<string, unknown>[] } };
      for (const doc of reply.cursor?.firstBatch ?? []) {
        if ("roomId" in doc) reads.push("moveHistory" in doc);
      }
    };
    client.on("commandSucceeded", listener);
    t.after(() => {
      client.off("commandSucceeded", listener);
    });
    return reads;
  }

  async function assertPersisted(id: string, expected: TurnRecord[]) {
    const doc = await raw(id);
    assert.ok(doc.moveHistory);
    if (doc.moveHistory.t) assert.equal(doc.moveHistory.t.length, doc.moveHistory.m.length);
    assert.deepEqual(compactToHistory(doc.moveHistory), expected);
    const reread = await store.getRoom(id);
    assert.deepEqual(reread?.state.history, expected);
  }

  test("appended moves persist exactly, with the save result matching a re-read", async (t) => {
    if (!mongoAvailable) return t.skip();
    await createRoom("APPEND");
    const updates: Record<string, Record<string, unknown>>[] = [];
    const findOneAndUpdate = GameRoom.findOneAndUpdate.bind(GameRoom);
    t.mock.method(GameRoom, "findOneAndUpdate", (...args: Parameters<typeof findOneAndUpdate>) => {
      updates.push(args[1] as Record<string, Record<string, unknown>>);
      return findOneAndUpdate(...args);
    });

    const moves = [
      { x: 5, y: 5 },
      { x: 6, y: 5 },
      { x: 9, y: 9 },
      { x: 7, y: 5 },
    ];
    let saved: StoredMultiplayerRoom | null = null;
    for (const [i, position] of moves.entries()) {
      saved = await play("APPEND", (state) => placePiece(state, position), 1_000 + i);
      await assertPersisted("APPEND", saved.state.history);
    }
    assert.equal(saved?.state.history.length, moves.length);
    assert.deepEqual(
      (await raw("APPEND")).moveHistory?.t,
      moves.map((_, i) => 1_000 + i),
    );
    // The first save has no stored history to extend; every later one appends.
    assert.ok(updates[0].$set.moveHistory);
    for (const update of updates.slice(1)) {
      assert.equal(update.$set.moveHistory, undefined);
      assert.deepEqual(Object.keys(update.$push), ["moveHistory.m", "moveHistory.t"]);
    }
  });

  test("a jump turn appends one record after its pending steps", async (t) => {
    if (!mongoAvailable) return t.skip();
    await createRoom("JUMP");
    await play("JUMP", (s) => placePiece(s, { x: 5, y: 5 }), 1); // white
    await play("JUMP", (s) => placePiece(s, { x: 6, y: 5 }), 2); // black
    await play("JUMP", (s) => placePiece(s, { x: 9, y: 9 }), 3); // white
    await play("JUMP", (s) => placePiece(s, { x: 12, y: 12 }), 4); // black
    const pending = await play("JUMP", (s) => jumpPiece(s, { x: 5, y: 5 }, { x: 7, y: 5 }), 5);
    assert.equal(pending.state.history.length, 4);
    await assertPersisted("JUMP", pending.state.history);
    const confirmed = await play("JUMP", confirmPendingJump, 6);
    assert.equal(confirmed.state.history.length, 5);
    assert.equal(confirmed.state.history[4].type, "jump");
    await assertPersisted("JUMP", confirmed.state.history);
  });

  test("a takeback rewrites the history and later moves append again", async (t) => {
    if (!mongoAvailable) return t.skip();
    await createRoom("TAKEBACK");
    await play("TAKEBACK", (s) => placePiece(s, { x: 3, y: 3 }), 1);
    await play("TAKEBACK", (s) => placePiece(s, { x: 4, y: 4 }), 2);
    const undone = await play("TAKEBACK", undoLastTurn, 3);
    assert.equal(undone.state.history.length, 1);
    await assertPersisted("TAKEBACK", undone.state.history);
    const replaced = await play("TAKEBACK", (s) => placePiece(s, { x: 8, y: 8 }), 4);
    assert.deepEqual(
      stripTimestamps(replaced.state.history),
      stripTimestamps([
        { type: "put", color: "white", position: { x: 3, y: 3 } },
        { type: "put", color: "black", position: { x: 8, y: 8 } },
      ]),
    );
    await assertPersisted("TAKEBACK", replaced.state.history);
  });

  test("a save that does not touch the history leaves moveHistory alone", async (t) => {
    if (!mongoAvailable) return t.skip();
    await createRoom("NOMOVE");
    await play("NOMOVE", (s) => placePiece(s, { x: 3, y: 3 }), 1);
    const before = await raw("NOMOVE");
    const room = await store.getRoom("NOMOVE");
    assert.ok(room);
    await store.saveRoom({
      ...room,
      takeback: { requestedBy: "white", declinedCount: { white: 0, black: 0 } },
    });
    const afterSave = await raw("NOMOVE");
    assert.equal(afterSave.revision, before.revision + 1);
    assert.deepEqual(afterSave.moveHistory, before.moveHistory);
  });

  test("meta records (forfeit, win) append with aligned timestamps", async (t) => {
    if (!mongoAvailable) return t.skip();
    await createRoom("FORFEIT");
    await play("FORFEIT", (s) => placePiece(s, { x: 3, y: 3 }), 1);
    const room = await store.getRoom("FORFEIT");
    assert.ok(room);
    const state = {
      ...room.state,
      history: [
        ...room.state.history,
        { type: "forfeit", color: "black", reason: "timeout" },
        { type: "win", color: "white" },
      ] as TurnRecord[],
    };
    const saved = await store.saveRoom({ ...room, state });
    const doc = await raw("FORFEIT");
    assert.deepEqual(doc.moveHistory?.t, [1, null, null]);
    await assertPersisted("FORFEIT", saved.state.history);
  });

  test("legacy rooms with inline history migrate to moveHistory on save", async (t) => {
    if (!mongoAvailable) return t.skip();
    await createRoom("LEGACY");
    // Pre-moveHistory layout: compact history inline as state.h, no timestamps.
    await GameRoom.updateOne(
      { roomId: "LEGACY" },
      {
        $set: {
          "state.h": { m: [[3, 3]] },
          "state.stones": { white: [[3, 3]], black: [] },
          "state.currentTurn": "black",
          moveHistory: null,
        },
      },
    ).exec();
    const legacy = await store.getRoom("LEGACY");
    assert.equal(legacy?.state.history.length, 1);

    const saved = await play("LEGACY", (s) => placePiece(s, { x: 4, y: 4 }), 2);
    assert.equal(saved.state.history.length, 2);
    await assertPersisted("LEGACY", saved.state.history);
    const next = await play("LEGACY", (s) => placePiece(s, { x: 5, y: 5 }), 3);
    await assertPersisted("LEGACY", next.state.history);
  });

  test("untimed history keeps working through full rewrites", async (t) => {
    if (!mongoAvailable) return t.skip();
    await createRoom("UNTIMED");
    for (const [i, position] of [
      { x: 3, y: 3 },
      { x: 4, y: 4 },
      { x: 5, y: 5 },
    ].entries()) {
      const room = await store.getRoom("UNTIMED");
      assert.ok(room);
      const saved = await store.saveRoom({
        ...room,
        state: unwrap(placePiece(room.state, position)),
      });
      assert.equal(saved.state.history.length, i + 1);
      const doc = await raw("UNTIMED");
      assert.equal(doc.moveHistory?.t, undefined);
      await assertPersisted("UNTIMED", saved.state.history);
    }
  });

  test("an append refuses to land on a history that changed underneath", async (t) => {
    if (!mongoAvailable) return t.skip();
    await createRoom("GUARD");
    await play("GUARD", (s) => placePiece(s, { x: 3, y: 3 }), 1);
    const room = await store.getRoom("GUARD");
    assert.ok(room);
    // A write that skips the revision bump (none exist today) must not be
    // silently extended.
    await GameRoom.updateOne(
      { roomId: "GUARD" },
      { $push: { "moveHistory.m": [9, 9], "moveHistory.t": 5 } },
    ).exec();
    await assert.rejects(
      store.saveRoom({ ...room, state: unwrap(placePiece(room.state, { x: 4, y: 4 })) }),
      /reload the room/,
    );
    // The revision did not move, so only forgetting the cached history on the
    // failed save lets the reload see the stored one.
    const reloaded = await store.getRoom("GUARD");
    assert.deepEqual(reloaded?.state.history, compactToHistory((await raw("GUARD")).moveHistory!));
    assert.equal(reloaded?.state.history.length, 2);
  });

  test("a re-read after a save reuses the cached history", async (t) => {
    if (!mongoAvailable) return t.skip();
    await createRoom("CACHE");
    await play("CACHE", (s) => placePiece(s, { x: 3, y: 3 }), 1);
    const reads = watchHistoryReads(t);
    await play("CACHE", (s) => placePiece(s, { x: 4, y: 4 }), 2);
    const saved = await play("CACHE", (s) => placePiece(s, { x: 5, y: 5 }), 3);
    const cached = await store.getRoom("CACHE");
    assert.deepEqual(reads, [false, false, false]);
    assert.ok(cached);
    assert.deepEqual(cached.state.history, saved.state.history);
    // The room's history is its own copy, not the cache's array.
    cached.state.history.pop();

    // Another instance has nothing cached and reads the stored history.
    const fresh = await new MongoGameRoomStore().getRoom("CACHE");
    assert.deepEqual(reads, [false, false, false, true]);
    assert.deepEqual(fresh?.state.history, saved.state.history);
    assert.equal(fresh?.revision, cached.revision);
    assert.deepEqual(compactToHistory((await raw("CACHE")).moveHistory!), saved.state.history);
    assert.equal((await store.getRoom("CACHE"))?.state.history.length, 3);
  });

  test("a save from another instance makes the cached history miss", async (t) => {
    if (!mongoAvailable) return t.skip();
    const other = new MongoGameRoomStore();
    await createRoom("FOREIGN");
    await play("FOREIGN", (s) => placePiece(s, { x: 3, y: 3 }), 1);
    await play("FOREIGN", (s) => placePiece(s, { x: 4, y: 4 }), 2);
    const foreign = await play("FOREIGN", (s) => placePiece(s, { x: 5, y: 5 }), 3, other);
    const reads = watchHistoryReads(t);
    const room = await store.getRoom("FOREIGN");
    assert.deepEqual(reads, [true]);
    assert.deepEqual(room?.state.history, foreign.state.history);
    assert.equal(room?.revision, foreign.revision);

    // The full read restored the append mark, so the next move appends again.
    const next = await play("FOREIGN", (s) => placePiece(s, { x: 6, y: 6 }), 4);
    assert.equal(next.state.history.length, 4);
    await assertPersisted("FOREIGN", next.state.history);
  });

  test("a recreated room with the same id and revision misses the cache", async (t) => {
    if (!mongoAvailable) return t.skip();
    await createRoom("REBORN");
    await play("REBORN", (s) => placePiece(s, { x: 3, y: 3 }), 1);
    const old = await play("REBORN", (s) => placePiece(s, { x: 4, y: 4 }), 2);
    await GameRoom.deleteOne({ roomId: "REBORN" }).exec();
    const other = new MongoGameRoomStore();
    await other.createRoom({ ...old, state: createInitialGameState() });
    await play("REBORN", (s) => placePiece(s, { x: 7, y: 7 }), 3, other);
    const reborn = await play("REBORN", (s) => placePiece(s, { x: 8, y: 8 }), 4, other);
    assert.equal(reborn.revision, old.revision);

    const reads = watchHistoryReads(t);
    const room = await store.getRoom("REBORN");
    assert.deepEqual(reads, [true]);
    assert.deepEqual(room?.state.history, reborn.state.history);
  });

  test("a takeback replaces the cached history, on this or another instance", async (t) => {
    if (!mongoAvailable) return t.skip();
    const other = new MongoGameRoomStore();
    await createRoom("UNDO");
    await play("UNDO", (s) => placePiece(s, { x: 3, y: 3 }), 1);
    await play("UNDO", (s) => placePiece(s, { x: 4, y: 4 }), 2);
    await play("UNDO", (s) => placePiece(s, { x: 5, y: 5 }), 3);

    // Takeback here: the rewrite is cached, and later moves append to it.
    const reads = watchHistoryReads(t);
    const undone = await play("UNDO", undoLastTurn, 4);
    assert.equal(undone.state.history.length, 2);
    const reread = await store.getRoom("UNDO");
    assert.deepEqual(reread?.state.history, undone.state.history);
    const replaced = await play("UNDO", (s) => placePiece(s, { x: 9, y: 9 }), 5);
    assert.deepEqual(reads, [false, false, false]);
    await assertPersisted("UNDO", replaced.state.history);

    // Takeback on another instance: this one reads the shorter history in full.
    const foreignUndo = await play("UNDO", undoLastTurn, 6, other);
    assert.equal(foreignUndo.state.history.length, 2);
    reads.length = 0;
    const afterForeign = await store.getRoom("UNDO");
    assert.deepEqual(reads, [true]);
    assert.deepEqual(afterForeign?.state.history, foreignUndo.state.history);
    const last = await play("UNDO", (s) => placePiece(s, { x: 10, y: 10 }), 7);
    assert.equal(last.state.history.length, 3);
    await assertPersisted("UNDO", last.state.history);
  });
});
