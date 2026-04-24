/**
 * Tests for the "first-move" achievement firing the instant a player makes
 * their first turn-completing move in a multiplayer game, rather than at game
 * end.
 *
 * The real `onFirstMoveMade` function talks to MongoDB, which isn't available
 * in unit tests. We mutate the achievementService module namespace to swap it
 * for a tracking stub, and we force `mongoose.connection.readyState` to 1 so
 * the gate in `gameService.applyAction` opens.
 */

import assert from "node:assert/strict";
import { before, beforeEach, describe, test } from "node:test";
import mongoose from "mongoose";
import type { PlayerIdentity } from "../../shared/src";
import { GameService } from "../game/gameService";
import { InMemoryGameRoomStore } from "../game/gameStore";

const firstMoveCalls: string[] = [];

before(async () => {
  const achievementMod = (await import("../game/achievementService")) as Record<string, unknown>;
  // Replace every achievement hook with a no-op stub so nothing else hits
  // the DB. Only `onFirstMoveMade` is the subject under test.
  achievementMod.onGameCompleted = async () => {};
  achievementMod.onEloUpdated = async () => {};
  achievementMod.onPieceCaptured = async () => {};
  achievementMod.onSpectateStarted = async () => {};
  achievementMod.onTournamentWon = async () => {};
  achievementMod.onFirstMoveMade = async (playerId: string) => {
    firstMoveCalls.push(playerId);
  };

  // The gate in gameService.applyAction checks
  // `mongoose.connection.readyState === 1` so it never schedules async DB
  // work in unit tests. Force it open here so we can exercise the path.
  Object.defineProperty(mongoose.connection, "readyState", {
    get: () => 1,
    configurable: true,
  });
});

beforeEach(() => {
  firstMoveCalls.length = 0;
});

function createAccount(playerId: string): PlayerIdentity {
  return { playerId, displayName: playerId, kind: "account" };
}

function createGuest(playerId: string): PlayerIdentity {
  return { playerId, displayName: playerId, kind: "guest" };
}

/**
 * Wait for fire-and-forget microtasks to resolve.
 * `void checkFirstMoveAchievement(...).catch(...)` in gameService schedules
 * the achievement grant without awaiting, so the test needs to yield control
 * to the event loop before asserting.
 */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("First Move achievement firing (gameService integration)", () => {
  test("fires for white on their first place-piece move", async () => {
    const store = new InMemoryGameRoomStore();
    // seatRandom = 0 → alice ends up as white (first to move)
    const service = new GameService(store, () => 0);
    const alice = createAccount("alice");
    const bob = createAccount("bob");

    const created = await service.createGame(alice);
    await service.joinGame(created.gameId, bob);

    await service.applyAction(created.gameId, alice, {
      type: "place-piece",
      position: { x: 9, y: 9 },
    });
    await flushMicrotasks();

    assert.deepEqual(firstMoveCalls, ["alice"]);
  });

  test("fires for black on their first place-piece move (after white has moved)", async () => {
    const store = new InMemoryGameRoomStore();
    const service = new GameService(store, () => 0);
    const alice = createAccount("alice");
    const bob = createAccount("bob");

    const created = await service.createGame(alice);
    await service.joinGame(created.gameId, bob);

    // White (alice) moves first — fires for alice
    await service.applyAction(created.gameId, alice, {
      type: "place-piece",
      position: { x: 9, y: 9 },
    });
    // Black (bob) moves — fires for bob, their first move in this game
    await service.applyAction(created.gameId, bob, {
      type: "place-piece",
      position: { x: 10, y: 10 },
    });
    await flushMicrotasks();

    assert.deepEqual(firstMoveCalls, ["alice", "bob"]);
  });

  test("does NOT fire again on white's second move in the same game", async () => {
    const store = new InMemoryGameRoomStore();
    const service = new GameService(store, () => 0);
    const alice = createAccount("alice");
    const bob = createAccount("bob");

    const created = await service.createGame(alice);
    await service.joinGame(created.gameId, bob);

    // Three plies: alice, bob, alice
    await service.applyAction(created.gameId, alice, {
      type: "place-piece",
      position: { x: 9, y: 9 },
    });
    await service.applyAction(created.gameId, bob, {
      type: "place-piece",
      position: { x: 10, y: 10 },
    });
    await service.applyAction(created.gameId, alice, {
      type: "place-piece",
      position: { x: 8, y: 8 },
    });
    await flushMicrotasks();

    // alice fires exactly once (on their first move), bob fires once
    assert.deepEqual(firstMoveCalls, ["alice", "bob"]);
  });

  test("does NOT fire for guest players (they cannot earn achievements)", async () => {
    const store = new InMemoryGameRoomStore();
    const service = new GameService(store, () => 0);
    const alice = createGuest("alice-guest");
    const bob = createGuest("bob-guest");

    const created = await service.createGame(alice);
    await service.joinGame(created.gameId, bob);

    await service.applyAction(created.gameId, alice, {
      type: "place-piece",
      position: { x: 9, y: 9 },
    });
    await flushMicrotasks();

    assert.deepEqual(firstMoveCalls, []);
  });
});
