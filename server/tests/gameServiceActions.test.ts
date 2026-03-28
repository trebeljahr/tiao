import assert from "node:assert/strict";
import { test } from "node:test";
import WebSocket from "ws";
import type { PlayerIdentity } from "../../shared/src";
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

test("place-piece action places a stone and switches turn", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);

  // White is alice (random = 0), so alice goes first
  const snapshot = await service.applyAction(created.gameId, alice, {
    type: "place-piece",
    position: { x: 9, y: 9 },
  });

  assert.equal(snapshot.state.currentTurn, "black");
  assert.equal(snapshot.state.positions[9][9], "white");
});

test("place-piece rejects when it is not the player's turn", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);

  // Bob is black, it's white's turn first
  await assert.rejects(
    () =>
      service.applyAction(created.gameId, bob, {
        type: "place-piece",
        position: { x: 9, y: 9 },
      }),
    (error) => isGameServiceError(error, "NOT_YOUR_TURN"),
  );
});

test("place-piece rejects spectator actions", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");
  const spectator = createPlayer("spectator");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);

  await assert.rejects(
    () =>
      service.applyAction(created.gameId, spectator, {
        type: "place-piece",
        position: { x: 9, y: 9 },
      }),
    (error) => isGameServiceError(error, "NOT_IN_GAME"),
  );
});

test("jump-piece and confirm-jump complete a capture sequence", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);

  // Setup: place pieces to enable a jump
  // White places at (5,5)
  await service.applyAction(created.gameId, alice, {
    type: "place-piece",
    position: { x: 5, y: 5 },
  });
  // Black places at (6,5)
  await service.applyAction(created.gameId, bob, {
    type: "place-piece",
    position: { x: 6, y: 5 },
  });
  // White places at (9,9) - some other position
  await service.applyAction(created.gameId, alice, {
    type: "place-piece",
    position: { x: 9, y: 9 },
  });
  // Black places at (10,10)
  await service.applyAction(created.gameId, bob, {
    type: "place-piece",
    position: { x: 10, y: 10 },
  });

  // Now white can jump from (5,5) over black at (6,5) to (7,5)
  const jumpSnapshot = await service.applyAction(created.gameId, alice, {
    type: "jump-piece",
    from: { x: 5, y: 5 },
    to: { x: 7, y: 5 },
  });

  assert.equal(jumpSnapshot.state.pendingJump.length, 1);
  assert.equal(jumpSnapshot.state.currentTurn, "white"); // still white's turn during jump

  const confirmedSnapshot = await service.applyAction(created.gameId, alice, {
    type: "confirm-jump",
  });

  assert.equal(confirmedSnapshot.state.currentTurn, "black");
  assert.equal(confirmedSnapshot.state.score.white, 1);
  assert.equal(confirmedSnapshot.state.pendingJump.length, 0);
});

test("undo-pending-jump-step rewinds the last hop", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);

  // Place pieces for jump
  await service.applyAction(created.gameId, alice, {
    type: "place-piece",
    position: { x: 5, y: 5 },
  });
  await service.applyAction(created.gameId, bob, {
    type: "place-piece",
    position: { x: 6, y: 5 },
  });
  await service.applyAction(created.gameId, alice, {
    type: "place-piece",
    position: { x: 9, y: 9 },
  });
  await service.applyAction(created.gameId, bob, {
    type: "place-piece",
    position: { x: 10, y: 10 },
  });

  // Jump
  await service.applyAction(created.gameId, alice, {
    type: "jump-piece",
    from: { x: 5, y: 5 },
    to: { x: 7, y: 5 },
  });

  // Undo the jump step
  const undone = await service.applyAction(created.gameId, alice, {
    type: "undo-pending-jump-step",
  });

  assert.equal(undone.state.pendingJump.length, 0);
  assert.equal(undone.state.positions[5][5], "white"); // piece is back
});

test("actions on waiting room are rejected", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");

  const created = await service.createGame(alice);

  await assert.rejects(
    () =>
      service.applyAction(created.gameId, alice, {
        type: "place-piece",
        position: { x: 9, y: 9 },
      }),
    (error) => isGameServiceError(error, "NOT_IN_GAME"),
  );
});

test("unknown action type is rejected", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);

  await assert.rejects(
    () =>
      service.applyAction(created.gameId, alice, {
        type: "invalid-action" as any,
      }),
    (error) => isGameServiceError(error, "UNKNOWN_ACTION"),
  );
});

test("broadcast sends snapshots to connected sockets", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);

  const aliceSocket = new FakeSocket() as unknown as WebSocket;
  const bobSocket = new FakeSocket() as unknown as WebSocket;

  await service.connect(created.gameId, alice, aliceSocket);
  await service.connect(created.gameId, bob, bobSocket);

  // Clear initial connection broadcast messages
  (aliceSocket as unknown as FakeSocket).messages = [];
  (bobSocket as unknown as FakeSocket).messages = [];

  await service.applyAction(created.gameId, alice, {
    type: "place-piece",
    position: { x: 9, y: 9 },
  });

  // Both players should receive the snapshot broadcast
  assert.ok((aliceSocket as unknown as FakeSocket).messages.length > 0);
  assert.ok((bobSocket as unknown as FakeSocket).messages.length > 0);

  const aliceMsg = JSON.parse((aliceSocket as unknown as FakeSocket).messages.at(-1)!);
  assert.equal(aliceMsg.type, "snapshot");
  assert.equal(aliceMsg.snapshot.state.currentTurn, "black");
});

test("rematch on active game is rejected", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);

  await assert.rejects(
    () => service.applyAction(created.gameId, alice, { type: "request-rematch" }),
    (error) => isGameServiceError(error, "GAME_NOT_FINISHED"),
  );
});

test("decline rematch without pending request is rejected", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);

  // Force finish
  const room = await store.getRoom(created.gameId);
  room!.state.score.white = 10;
  room!.status = "finished";
  await store.saveRoom(room!);

  await assert.rejects(
    () => service.applyAction(created.gameId, bob, { type: "decline-rematch" }),
    (error) => isGameServiceError(error, "NO_REMATCH_REQUEST"),
  );
});
