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
// Forfeit Edge Case Tests
// ---------------------------------------------------------------------------

test("forfeit with pending takeback — takeback becomes irrelevant, game finishes with forfeit", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);

  // Alice (white) makes a move, then Bob (black) makes a move
  await service.applyAction(created.gameId, alice, {
    type: "place-piece",
    position: { x: 9, y: 9 },
  });
  await service.applyAction(created.gameId, bob, {
    type: "place-piece",
    position: { x: 8, y: 8 },
  });

  // Bob requests a takeback
  const afterTakeback = await service.applyAction(created.gameId, bob, {
    type: "request-takeback",
  });
  assert.ok(afterTakeback.takeback, "expected a pending takeback request");

  // Alice forfeits instead of responding to the takeback
  const snapshot = await service.applyAction(created.gameId, alice, {
    type: "forfeit",
  });

  assert.equal(snapshot.status, "finished");
  assert.equal(getWinner(snapshot.state), "black");

  // History should end with forfeit + win records
  const lastRecords = snapshot.state.history.slice(-2);
  assert.equal(lastRecords[0].type, "forfeit");
  assert.equal(lastRecords[0].color, "white");
  assert.equal(lastRecords[1].type, "win");
  assert.equal(lastRecords[1].color, "black");
});

test("forfeit during opponent's turn — forfeit is always allowed for active games", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);

  // It's white's (alice's) turn. Bob (black) forfeits even though it's not his turn.
  const snapshot = await service.applyAction(created.gameId, bob, {
    type: "forfeit",
  });

  assert.equal(snapshot.status, "finished");
  assert.equal(getWinner(snapshot.state), "white");
});

test("spectator cannot forfeit — NOT_IN_GAME error", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");
  const spectator = createPlayer("spectator");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);

  // Connect the spectator to the game
  const spectatorSocket = new FakeSocket() as unknown as WebSocket;
  await service.connect(created.gameId, spectator, spectatorSocket);

  // Spectator tries to forfeit — should fail with NOT_IN_GAME
  await assert.rejects(
    () =>
      service.applyAction(created.gameId, spectator, {
        type: "forfeit",
      }),
    (error) => isGameServiceError(error, "NOT_IN_GAME"),
  );
});

test("forfeit game with moves played — score reflects forfeit, not current board score", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);

  // Play several moves
  await service.applyAction(created.gameId, alice, {
    type: "place-piece",
    position: { x: 9, y: 9 },
  });
  await service.applyAction(created.gameId, bob, {
    type: "place-piece",
    position: { x: 8, y: 8 },
  });
  await service.applyAction(created.gameId, alice, {
    type: "place-piece",
    position: { x: 7, y: 7 },
  });
  await service.applyAction(created.gameId, bob, {
    type: "place-piece",
    position: { x: 6, y: 6 },
  });

  // Bob (black) forfeits
  const snapshot = await service.applyAction(created.gameId, bob, {
    type: "forfeit",
  });

  assert.equal(snapshot.status, "finished");
  assert.equal(getWinner(snapshot.state), "white");
  // Scores should remain unchanged — forfeit doesn't inflate the score
  assert.equal(snapshot.state.score.white, 0);
  assert.equal(snapshot.state.score.black, 0);
  // But the game should be marked as finished with a forfeit record
  assert.ok(
    snapshot.state.history.some((r) => r.type === "forfeit"),
    "expected a forfeit record in history",
  );
});

test("rematch after forfeit preserves boardSize, scoreToWin, and timeControl from original game", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const customSettings = {
    gameSettings: { boardSize: 13, scoreToWin: 3 },
    timeControl: { initialMs: 300_000, incrementMs: 5_000 } as const,
  };

  const created = await service.createGame(alice, customSettings);
  await service.joinGame(created.gameId, bob);

  // Verify the original game has custom settings
  assert.equal(created.state.boardSize, 13);
  assert.equal(created.state.scoreToWin, 3);

  // Alice forfeits
  await service.applyAction(created.gameId, alice, {
    type: "forfeit",
  });

  // Connect sockets to capture the rematch-started message
  const aliceSocket = new FakeSocket() as unknown as WebSocket;
  await service.connect(created.gameId, alice, aliceSocket);
  (aliceSocket as unknown as FakeSocket).messages = [];

  // Both request rematch
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
  assert.equal(newSnapshot.state.boardSize, 13, "boardSize should be preserved");
  assert.equal(newSnapshot.state.scoreToWin, 3, "scoreToWin should be preserved");
  assert.deepEqual(newSnapshot.timeControl, { initialMs: 300_000, incrementMs: 5_000 });
});

test("rematch request then decline — rematch state is cleaned up", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);
  await finishRoom(store, created.gameId, "white");

  // Alice requests rematch
  const afterRequest = await service.applyAction(created.gameId, alice, {
    type: "request-rematch",
  });
  assert.ok(afterRequest.rematch, "expected rematch state after request");
  assert.ok(
    afterRequest.rematch!.requestedBy.includes("white"),
    "expected white to have requested rematch",
  );

  // Bob declines rematch
  const afterDecline = await service.applyAction(created.gameId, bob, {
    type: "decline-rematch",
  });
  assert.equal(afterDecline.rematch, null, "expected rematch state to be null after decline");
  assert.equal(afterDecline.status, "finished", "game should still be finished");

  // Verify via the store as well
  const room = await store.getRoom(created.gameId);
  assert.equal(room!.rematch, null, "expected stored rematch to be null");
});

test("double forfeit attempt — second forfeit gets GAME_NOT_ACTIVE error", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);

  // Alice forfeits
  const snapshot = await service.applyAction(created.gameId, alice, {
    type: "forfeit",
  });
  assert.equal(snapshot.status, "finished");

  // Alice tries to forfeit again
  await assert.rejects(
    () =>
      service.applyAction(created.gameId, alice, {
        type: "forfeit",
      }),
    (error) => isGameServiceError(error, "GAME_NOT_ACTIVE"),
  );

  // Bob also cannot forfeit a finished game
  await assert.rejects(
    () =>
      service.applyAction(created.gameId, bob, {
        type: "forfeit",
      }),
    (error) => isGameServiceError(error, "GAME_NOT_ACTIVE"),
  );
});

test("forfeit notifies all connected players via WebSocket with snapshot message", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);

  // Connect both players via WebSocket
  const aliceSocket = new FakeSocket() as unknown as WebSocket;
  const bobSocket = new FakeSocket() as unknown as WebSocket;
  await service.connect(created.gameId, alice, aliceSocket);
  await service.connect(created.gameId, bob, bobSocket);

  // Clear initial connection messages
  (aliceSocket as unknown as FakeSocket).messages = [];
  (bobSocket as unknown as FakeSocket).messages = [];

  // Alice forfeits
  await service.applyAction(created.gameId, alice, {
    type: "forfeit",
  });

  // Both sockets should have received a snapshot message
  const aliceMessages = (aliceSocket as unknown as FakeSocket).messages.map((m) => JSON.parse(m));
  const bobMessages = (bobSocket as unknown as FakeSocket).messages.map((m) => JSON.parse(m));

  const aliceSnapshotMsg = aliceMessages.find((m) => m.type === "snapshot");
  const bobSnapshotMsg = bobMessages.find((m) => m.type === "snapshot");

  assert.ok(aliceSnapshotMsg, "expected alice to receive a snapshot message");
  assert.ok(bobSnapshotMsg, "expected bob to receive a snapshot message");

  assert.equal(aliceSnapshotMsg.snapshot.status, "finished");
  assert.equal(bobSnapshotMsg.snapshot.status, "finished");
  assert.equal(getWinner(aliceSnapshotMsg.snapshot.state), "black");
  assert.equal(getWinner(bobSnapshotMsg.snapshot.state), "black");
});
