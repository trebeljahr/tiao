import assert from "node:assert/strict";
import { test } from "node:test";
import type { PlayerIdentity } from "../../shared/src";
import { GameService } from "../game/gameService";
import { InMemoryGameRoomStore } from "../game/gameStore";

function createPlayer(playerId: string, options: Partial<PlayerIdentity> = {}): PlayerIdentity {
  return {
    playerId,
    displayName: options.displayName ?? playerId,
    kind: options.kind ?? "account",
    email: options.email,
    profilePicture: options.profilePicture,
  };
}


test("entering matchmaking twice returns searching status", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");

  const first = await service.enterMatchmaking(alice);
  assert.equal(first.status, "searching");

  const second = await service.enterMatchmaking(alice);
  assert.equal(second.status, "searching");
});

test("leave matchmaking removes player from queue", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");

  await service.enterMatchmaking(alice);
  await service.leaveMatchmaking(alice);

  const state = await service.getMatchmakingState(alice);
  assert.equal(state.status, "idle");
});

test("leave matchmaking clears matched state", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  await service.enterMatchmaking(alice);
  const matched = await service.enterMatchmaking(bob);
  assert.equal(matched.status, "matched");

  // Alice was matched - leave matchmaking should clear state
  await service.leaveMatchmaking(alice);
  const state = await service.getMatchmakingState(alice);
  assert.equal(state.status, "idle");
});

test("guest player with active game can still enter matchmaking", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const guest = createPlayer("guest-mm", { kind: "guest" });
  const host = createPlayer("host");

  // Create an active game for the guest
  const game = await service.createGame(guest);
  await service.joinGame(game.gameId, host);

  // Guest should be able to enter matchmaking even with an active game
  const result = await service.enterMatchmaking(guest);
  assert.equal(result.status, "searching");
});

test("matchmaking creates room with matchmaking type", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  await service.enterMatchmaking(alice);
  const result = await service.enterMatchmaking(bob);

  assert.equal(result.status, "matched");
  if (result.status === "matched") {
    assert.equal(result.snapshot.roomType, "matchmaking");
    assert.equal(result.snapshot.status, "active");
    assert.equal(result.snapshot.players.length, 2);
  }
});

test("matchmaking state for unqueued player is idle", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");

  const state = await service.getMatchmakingState(alice);
  assert.equal(state.status, "idle");
});

test("three players matchmaking pairs first two", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");
  const carol = createPlayer("carol");

  const first = await service.enterMatchmaking(alice);
  assert.equal(first.status, "searching");

  const second = await service.enterMatchmaking(bob);
  assert.equal(second.status, "matched");

  // Carol enters after Alice and Bob are matched
  const third = await service.enterMatchmaking(carol);
  assert.equal(third.status, "searching");
});

test("leave matchmaking when not in queue is a no-op", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");

  // Should not throw
  await service.leaveMatchmaking(alice);
  const state = await service.getMatchmakingState(alice);
  assert.equal(state.status, "idle");
});

// --- Time control matchmaking tests ---

const TC_30_0 = { initialMs: 1_800_000, incrementMs: 0 };
const TC_10_5 = { initialMs: 600_000, incrementMs: 5_000 };

test("two players with same time control get matched", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const first = await service.enterMatchmaking(alice, TC_30_0);
  assert.equal(first.status, "searching");

  const second = await service.enterMatchmaking(bob, TC_30_0);
  assert.equal(second.status, "matched");

  if (second.status === "matched") {
    assert.equal(second.snapshot.timeControl?.initialMs, TC_30_0.initialMs);
    assert.equal(second.snapshot.timeControl?.incrementMs, TC_30_0.incrementMs);
    assert.ok(second.snapshot.clock);
  }
});

test("two players with different time controls do NOT match", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const first = await service.enterMatchmaking(alice, TC_30_0);
  assert.equal(first.status, "searching");

  const second = await service.enterMatchmaking(bob, TC_10_5);
  assert.equal(second.status, "searching");
});

test("timed player does NOT match untimed player", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  await service.enterMatchmaking(alice, TC_30_0);
  const result = await service.enterMatchmaking(bob, null);
  assert.equal(result.status, "searching");
});

test("two untimed players match each other", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  await service.enterMatchmaking(alice, null);
  const result = await service.enterMatchmaking(bob, null);
  assert.equal(result.status, "matched");

  if (result.status === "matched") {
    assert.equal(result.snapshot.timeControl, null);
    assert.equal(result.snapshot.clock, null);
  }
});

test("three players: A(30+0), B(10+5), C(30+0) — A and C match, B stays", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");
  const carol = createPlayer("carol");

  const first = await service.enterMatchmaking(alice, TC_30_0);
  assert.equal(first.status, "searching");

  const second = await service.enterMatchmaking(bob, TC_10_5);
  assert.equal(second.status, "searching");

  // Carol enters with 30+0 — should match Alice, not Bob
  const third = await service.enterMatchmaking(carol, TC_30_0);
  assert.equal(third.status, "matched");

  // Bob is still searching
  const bobState = await service.getMatchmakingState(bob);
  assert.equal(bobState.status, "searching");

  // Alice was matched
  const aliceState = await service.getMatchmakingState(alice);
  assert.equal(aliceState.status, "matched");
});

test("matched timed game has correct clock state", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  await service.enterMatchmaking(alice, TC_30_0);
  const result = await service.enterMatchmaking(bob, TC_30_0);

  assert.equal(result.status, "matched");
  if (result.status === "matched") {
    const { clock } = result.snapshot;
    assert.ok(clock);
    assert.equal(clock!.white, TC_30_0.initialMs);
    assert.equal(clock!.black, TC_30_0.initialMs);
    assert.ok(clock!.lastMoveAt);
  }
});
