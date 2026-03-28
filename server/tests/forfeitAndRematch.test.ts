import assert from "node:assert/strict";
import { test } from "node:test";
import WebSocket from "ws";
import type { PlayerIdentity } from "../../shared/src";
import { SCORE_TO_WIN, getWinner } from "../../shared/src";
import { GameService, GameServiceError } from "../game/gameService";
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

async function finishRoom(store: InMemoryGameRoomStore, roomId: string, winner: "white" | "black") {
  const room = await store.getRoom(roomId);
  assert.ok(room, "expected room to exist");
  room.state.score[winner] = SCORE_TO_WIN;
  room.status = "finished";
  await store.saveRoom(room);
}

class FakeSocket {
  readyState = WebSocket.OPEN;
  messages: string[] = [];

  send(message: string) {
    this.messages.push(message);
  }
}

function isGameServiceError(error: unknown, code: string): error is GameServiceError {
  return error instanceof GameServiceError && error.code === code;
}

// ---------------------------------------------------------------------------
// Forfeit Tests
// ---------------------------------------------------------------------------

test("a player can forfeit an active game and the opponent wins", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);

  // Alice (white) forfeits
  const snapshot = await service.applyAction(created.gameId, alice, {
    type: "forfeit",
  });

  assert.equal(snapshot.status, "finished");
  // Bob (black) should be the winner (via win record, not score inflation)
  assert.equal(getWinner(snapshot.state), "black");
});

test("cannot forfeit a game that is not active (waiting)", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");

  const created = await service.createGame(alice);

  // Game is in "waiting" status — alice is the only player and not seated
  await assert.rejects(
    () =>
      service.applyAction(created.gameId, alice, {
        type: "forfeit",
      }),
    (error) => isGameServiceError(error, "NOT_IN_GAME"),
  );
});

test("cannot forfeit a game that is already finished", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);
  await finishRoom(store, created.gameId, "white");

  await assert.rejects(
    () =>
      service.applyAction(created.gameId, alice, {
        type: "forfeit",
      }),
    (error) => isGameServiceError(error, "GAME_NOT_ACTIVE"),
  );
});

test("forfeit marks the opponent as winner without changing scores", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);

  // Bob (black) forfeits — white (alice) should win
  const snapshot = await service.applyAction(created.gameId, bob, {
    type: "forfeit",
  });

  assert.equal(getWinner(snapshot.state), "white");
  // Scores should remain at 0 — forfeit doesn't inflate them
  assert.equal(snapshot.state.score.white, 0);
  assert.equal(snapshot.state.score.black, 0);
  assert.equal(snapshot.status, "finished");
});

test("after forfeit the game history includes a forfeit record", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);

  // Make one move first then forfeit
  await service.applyAction(created.gameId, alice, {
    type: "place-piece",
    position: { x: 9, y: 9 },
  });

  const snapshot = await service.applyAction(created.gameId, bob, {
    type: "forfeit",
  });

  // History should include: put, forfeit, win
  assert.equal(snapshot.state.history.length, 3);
  assert.equal(snapshot.state.history[0].type, "put");

  const forfeitEntry = snapshot.state.history[1];
  assert.equal(forfeitEntry.type, "forfeit");
  assert.equal(forfeitEntry.color, "black");

  const winEntry = snapshot.state.history[2];
  assert.equal(winEntry.type, "win");
  assert.equal(winEntry.color, "white");
});

// ---------------------------------------------------------------------------
// Rematch — New Game Room Tests
// ---------------------------------------------------------------------------

test("when both players request rematch a new room is created with a different ID", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);
  await finishRoom(store, created.gameId, "white");

  // Connect sockets so we can capture the rematch-started message
  const aliceSocket = new FakeSocket() as unknown as WebSocket;
  await service.connect(created.gameId, alice, aliceSocket);
  (aliceSocket as unknown as FakeSocket).messages = [];

  await service.applyAction(created.gameId, alice, {
    type: "request-rematch",
  });

  await service.applyAction(created.gameId, bob, {
    type: "request-rematch",
  });

  // The socket should have received a rematch-started message with the new game ID
  const rematchMsg = (aliceSocket as unknown as FakeSocket).messages
    .map((m) => JSON.parse(m))
    .find((m) => m.type === "rematch-started");

  assert.ok(rematchMsg, "expected a rematch-started message");
  assert.notEqual(rematchMsg.gameId, created.gameId);

  // Verify the new room actually exists
  const newSnapshot = await service.getSnapshot(rematchMsg.gameId);
  assert.ok(newSnapshot, "expected the new room to exist");
});

test("the old room rematch state is cleared after both players accept", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);
  await finishRoom(store, created.gameId, "white");

  await service.applyAction(created.gameId, alice, {
    type: "request-rematch",
  });

  const newRoomSnapshot = await service.applyAction(created.gameId, bob, {
    type: "request-rematch",
  });

  // The returned snapshot is the NEW room
  assert.equal(newRoomSnapshot.status, "active");
  assert.equal(newRoomSnapshot.rematch, null);

  // The OLD room should have its rematch state cleared
  const oldRoom = await store.getRoom(created.gameId);
  assert.equal(oldRoom!.status, "finished");
  assert.equal(oldRoom!.rematch, null);
});

test("the new rematch room has fresh game state with score 0-0", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);

  // Make some moves before finishing
  await service.applyAction(created.gameId, alice, {
    type: "place-piece",
    position: { x: 9, y: 9 },
  });

  await finishRoom(store, created.gameId, "white");

  // Connect a socket to capture the new game ID
  const aliceSocket = new FakeSocket() as unknown as WebSocket;
  await service.connect(created.gameId, alice, aliceSocket);
  (aliceSocket as unknown as FakeSocket).messages = [];

  await service.applyAction(created.gameId, alice, {
    type: "request-rematch",
  });
  await service.applyAction(created.gameId, bob, {
    type: "request-rematch",
  });

  const rematchMsg = (aliceSocket as unknown as FakeSocket).messages
    .map((m) => JSON.parse(m))
    .find((m) => m.type === "rematch-started");

  assert.ok(rematchMsg, "expected a rematch-started message");

  const newSnapshot = await service.getSnapshot(rematchMsg.gameId);
  assert.deepEqual(newSnapshot.state.score, { black: 0, white: 0 });
  assert.equal(newSnapshot.state.history.length, 0);
  assert.equal(newSnapshot.state.currentTurn, "white");
});

test("the new rematch room has both players assigned to seats", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);
  await finishRoom(store, created.gameId, "white");

  // Connect a socket to capture the new game ID
  const aliceSocket = new FakeSocket() as unknown as WebSocket;
  await service.connect(created.gameId, alice, aliceSocket);
  (aliceSocket as unknown as FakeSocket).messages = [];

  await service.applyAction(created.gameId, alice, {
    type: "request-rematch",
  });
  await service.applyAction(created.gameId, bob, {
    type: "request-rematch",
  });

  const rematchMsg = (aliceSocket as unknown as FakeSocket).messages
    .map((m) => JSON.parse(m))
    .find((m) => m.type === "rematch-started");

  assert.ok(rematchMsg, "expected a rematch-started message");

  const newSnapshot = await service.getSnapshot(rematchMsg.gameId);
  assert.equal(newSnapshot.status, "active");
  assert.equal(newSnapshot.players.length, 2);
  assert.ok(newSnapshot.seats.white, "expected white seat to be assigned");
  assert.ok(newSnapshot.seats.black, "expected black seat to be assigned");

  // Both alice and bob should be in the new game
  const playerIds = newSnapshot.players.map((p) => p.player.playerId).sort();
  assert.deepEqual(playerIds, ["alice", "bob"]);
});
