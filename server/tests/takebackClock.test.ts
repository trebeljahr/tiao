import assert from "node:assert/strict";
import { test } from "node:test";
import WebSocket from "ws";
import type { PlayerIdentity, TimeControl } from "../../shared/src";
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

class FakeSocket {
  readyState = WebSocket.OPEN;
  messages: string[] = [];
  send(message: string) {
    this.messages.push(message);
  }
}

// 5-minute clock with 2s increment
const TC: TimeControl = { initialMs: 300_000, incrementMs: 2_000 };

test("takeback restores clock correctly for instant moves", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const aliceSocket = new FakeSocket() as unknown as WebSocket;
  const bobSocket = new FakeSocket() as unknown as WebSocket;

  await service.enterMatchmaking(alice, TC);
  const matched = await service.enterMatchmaking(bob, TC);
  assert.ok(matched.status === "matched");
  const gameId = matched.snapshot.gameId;

  await service.connect(gameId, alice, aliceSocket);
  await service.connect(gameId, bob, bobSocket);

  // Alice (white) makes first move
  const afterFirst = await service.applyAction(gameId, alice, {
    type: "place-piece",
    position: { x: 9, y: 9 },
  });
  assert.ok(afterFirst.clock);
  const whiteAfterFirst = afterFirst.clock.white;

  // Bob (black) makes a move
  await service.applyAction(gameId, bob, {
    type: "place-piece",
    position: { x: 10, y: 10 },
  });

  // Alice makes another move
  const afterThird = await service.applyAction(gameId, alice, {
    type: "place-piece",
    position: { x: 8, y: 8 },
  });
  assert.ok(afterThird.clock);
  const whiteAfterThird = afterThird.clock.white;

  // Alice requests takeback
  await service.applyAction(gameId, alice, { type: "request-takeback" });

  // Bob accepts
  const afterTakeback = await service.applyAction(gameId, bob, {
    type: "accept-takeback",
  });
  assert.ok(afterTakeback.clock);

  // After takeback, white's clock should be restored to approximately
  // what it was after the first move (the undone move's deduction + increment reversed)
  const diff = Math.abs(afterTakeback.clock.white - whiteAfterFirst);
  assert.ok(
    diff < 1_000,
    `clock should be restored to ~${whiteAfterFirst}ms but got ${afterTakeback.clock.white}ms (diff: ${diff}ms)`,
  );
});

test("takeback sets lastMoveAt to current time, not a stale historical timestamp", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const aliceSocket = new FakeSocket() as unknown as WebSocket;
  const bobSocket = new FakeSocket() as unknown as WebSocket;

  await service.enterMatchmaking(alice, TC);
  const matched = await service.enterMatchmaking(bob, TC);
  assert.ok(matched.status === "matched");
  const gameId = matched.snapshot.gameId;

  await service.connect(gameId, alice, aliceSocket);
  await service.connect(gameId, bob, bobSocket);

  // Make three moves
  await service.applyAction(gameId, alice, {
    type: "place-piece",
    position: { x: 9, y: 9 },
  });
  await service.applyAction(gameId, bob, {
    type: "place-piece",
    position: { x: 10, y: 10 },
  });
  await service.applyAction(gameId, alice, {
    type: "place-piece",
    position: { x: 8, y: 8 },
  });

  // Request and accept takeback
  await service.applyAction(gameId, alice, { type: "request-takeback" });
  await service.applyAction(gameId, bob, { type: "accept-takeback" });

  // lastMoveAt should be recent, not a stale historical timestamp
  const room = await store.getRoom(gameId);
  assert.ok(room);
  assert.ok(room.lastMoveAt);

  const ageMs = Date.now() - room.lastMoveAt.getTime();
  assert.ok(ageMs < 2_000, `lastMoveAt should be recent (within 2s) but is ${ageMs}ms old`);
});

test("double takeback (requester's turn) restores both clocks correctly", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const aliceSocket = new FakeSocket() as unknown as WebSocket;
  const bobSocket = new FakeSocket() as unknown as WebSocket;

  await service.enterMatchmaking(alice, TC);
  const matched = await service.enterMatchmaking(bob, TC);
  assert.ok(matched.status === "matched");
  const gameId = matched.snapshot.gameId;

  await service.connect(gameId, alice, aliceSocket);
  await service.connect(gameId, bob, bobSocket);

  // Alice moves, Bob moves, Alice moves, Bob moves
  await service.applyAction(gameId, alice, {
    type: "place-piece",
    position: { x: 9, y: 9 },
  });
  const afterBobFirst = await service.applyAction(gameId, bob, {
    type: "place-piece",
    position: { x: 10, y: 10 },
  });
  assert.ok(afterBobFirst.clock);
  const blackAfterBobFirst = afterBobFirst.clock.black;

  await service.applyAction(gameId, alice, {
    type: "place-piece",
    position: { x: 8, y: 8 },
  });
  await service.applyAction(gameId, bob, {
    type: "place-piece",
    position: { x: 11, y: 11 },
  });

  // Now it's Alice's turn. Alice requests takeback (wants to undo her last move).
  // Since it's Alice's turn, the server undoes Bob's move AND Alice's move.
  await service.applyAction(gameId, alice, { type: "request-takeback" });
  const afterTakeback = await service.applyAction(gameId, bob, {
    type: "accept-takeback",
  });
  assert.ok(afterTakeback.clock);

  // Bob's clock should be restored to approximately what it was after his first move
  const diff = Math.abs(afterTakeback.clock.black - blackAfterBobFirst);
  assert.ok(
    diff < 1_000,
    `bob's clock should be restored to ~${blackAfterBobFirst}ms but got ${afterTakeback.clock.black}ms (diff: ${diff}ms)`,
  );

  // lastMoveAt should be recent
  const room = await store.getRoom(gameId);
  assert.ok(room?.lastMoveAt);
  assert.ok(Date.now() - room.lastMoveAt.getTime() < 2_000);
});
