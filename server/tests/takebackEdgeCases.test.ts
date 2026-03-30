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

/**
 * Helper: create a 2-player game with both players connected.
 * alice = white (random=0), bob = black.
 */
async function setupGame() {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const aliceSocket = new FakeSocket() as unknown as WebSocket;
  const bobSocket = new FakeSocket() as unknown as WebSocket;

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);

  await service.connect(created.gameId, alice, aliceSocket);
  await service.connect(created.gameId, bob, bobSocket);

  return { store, service, alice, bob, gameId: created.gameId, aliceSocket, bobSocket };
}

// ---------------------------------------------------------------------------
// 1. Takeback decline counter increments and hits TAKEBACK_LIMIT after 3
// ---------------------------------------------------------------------------
test("takeback decline counter increments and hits TAKEBACK_LIMIT after 3 declines", async () => {
  const { store, service, alice, bob, gameId } = await setupGame();

  // Alice makes a move so there's something to take back
  await service.applyAction(gameId, alice, {
    type: "place-piece",
    position: { x: 9, y: 9 },
  });
  await service.applyAction(gameId, bob, {
    type: "place-piece",
    position: { x: 10, y: 10 },
  });

  // Decline 1
  await service.applyAction(gameId, alice, { type: "request-takeback" });
  await service.applyAction(gameId, bob, { type: "decline-takeback" });

  let room = await store.getRoom(gameId);
  assert.equal(room!.takeback?.declinedCount.white, 1);

  // Decline 2 — alice needs to make a move and then request again
  // Actually the limit is on requests, not on moves. Alice can request again immediately.
  await service.applyAction(gameId, alice, { type: "request-takeback" });
  await service.applyAction(gameId, bob, { type: "decline-takeback" });

  room = await store.getRoom(gameId);
  assert.equal(room!.takeback?.declinedCount.white, 2);

  // Decline 3
  await service.applyAction(gameId, alice, { type: "request-takeback" });
  await service.applyAction(gameId, bob, { type: "decline-takeback" });

  room = await store.getRoom(gameId);
  assert.equal(room!.takeback?.declinedCount.white, 3);

  // 4th request should be rejected with TAKEBACK_LIMIT
  await assert.rejects(
    () => service.applyAction(gameId, alice, { type: "request-takeback" }),
    (error) => isGameServiceError(error, "TAKEBACK_LIMIT"),
  );
});

// ---------------------------------------------------------------------------
// 2. Takeback after capture reverses the score and restores pieces
// ---------------------------------------------------------------------------
test("takeback after capture reverses score and restores captured piece", async () => {
  const { service, alice, bob, gameId } = await setupGame();

  // Set up a capturable position:
  // White at (5,5), Black at (6,5), then white jumps over black to (7,5)
  await service.applyAction(gameId, alice, {
    type: "place-piece",
    position: { x: 5, y: 5 },
  });
  await service.applyAction(gameId, bob, {
    type: "place-piece",
    position: { x: 6, y: 5 },
  });
  // White places elsewhere (interior) to give bob another turn
  await service.applyAction(gameId, alice, {
    type: "place-piece",
    position: { x: 9, y: 9 },
  });
  await service.applyAction(gameId, bob, {
    type: "place-piece",
    position: { x: 10, y: 10 },
  });

  // Now white jumps from (5,5) over (6,5) to (7,5)
  await service.applyAction(gameId, alice, {
    type: "jump-piece",
    from: { x: 5, y: 5 },
    to: { x: 7, y: 5 },
  });

  const afterConfirm = await service.applyAction(gameId, alice, {
    type: "confirm-jump",
  });

  assert.equal(afterConfirm.state.score.white, 1, "white should have 1 capture");
  assert.equal(afterConfirm.state.positions[5][7], "white", "white piece at (7,5)");
  assert.equal(afterConfirm.state.positions[5][6], null, "captured black piece removed from (6,5)");
  assert.equal(afterConfirm.state.positions[5][5], null, "origin (5,5) is empty");

  // Now it's bob's turn. Alice requests takeback of her jump.
  // Since it's bob's turn (the opponent), only Alice's last move is undone.
  await service.applyAction(gameId, alice, { type: "request-takeback" });
  const afterTakeback = await service.applyAction(gameId, bob, {
    type: "accept-takeback",
  });

  assert.equal(afterTakeback.state.score.white, 0, "score should be reversed to 0");
  assert.equal(afterTakeback.state.positions[5][5], "white", "white piece restored to (5,5)");
  assert.equal(afterTakeback.state.positions[5][6], "black", "black piece restored at (6,5)");
  assert.equal(afterTakeback.state.positions[5][7], null, "jump destination (7,5) is empty");
  assert.equal(afterTakeback.state.currentTurn, "white", "should be white's turn again");
});

// ---------------------------------------------------------------------------
// 3. Concurrent takeback attempts — second request gets TAKEBACK_PENDING
// ---------------------------------------------------------------------------
test("concurrent takeback: second request gets TAKEBACK_PENDING", async () => {
  const { service, alice, bob, gameId } = await setupGame();

  // Both players need at least one move each
  await service.applyAction(gameId, alice, {
    type: "place-piece",
    position: { x: 9, y: 9 },
  });
  await service.applyAction(gameId, bob, {
    type: "place-piece",
    position: { x: 10, y: 10 },
  });

  // Alice requests takeback
  await service.applyAction(gameId, alice, { type: "request-takeback" });

  // Bob also tries to request a takeback — should fail since one is pending
  await assert.rejects(
    () => service.applyAction(gameId, bob, { type: "request-takeback" }),
    (error) => isGameServiceError(error, "TAKEBACK_PENDING"),
  );
});

// ---------------------------------------------------------------------------
// 4. Takeback on first move undoes to initial state
// ---------------------------------------------------------------------------
test("takeback on first move undoes to initial empty board", async () => {
  const { service, alice, bob, gameId } = await setupGame();

  // Alice makes the very first move
  await service.applyAction(gameId, alice, {
    type: "place-piece",
    position: { x: 9, y: 9 },
  });

  assert.equal((await service.getSnapshot(gameId)).state.positions[9][9], "white");

  // It's now bob's turn. Alice requests takeback (her only move).
  // Since it's bob's turn, only Alice's last move is undone.
  await service.applyAction(gameId, alice, { type: "request-takeback" });
  const afterTakeback = await service.applyAction(gameId, bob, {
    type: "accept-takeback",
  });

  assert.equal(afterTakeback.state.positions[9][9], null, "first move should be undone");
  assert.equal(afterTakeback.state.currentTurn, "white", "turn returns to white");
  assert.equal(afterTakeback.state.history.length, 0, "history should be empty");
});

// ---------------------------------------------------------------------------
// 5. Player cannot accept their own takeback request
// ---------------------------------------------------------------------------
test("player cannot accept their own takeback request", async () => {
  const { service, alice, bob, gameId } = await setupGame();

  await service.applyAction(gameId, alice, {
    type: "place-piece",
    position: { x: 9, y: 9 },
  });
  await service.applyAction(gameId, bob, {
    type: "place-piece",
    position: { x: 10, y: 10 },
  });

  // Alice requests a takeback
  await service.applyAction(gameId, alice, { type: "request-takeback" });

  // Alice tries to accept her own takeback — should fail
  await assert.rejects(
    () => service.applyAction(gameId, alice, { type: "accept-takeback" }),
    (error) => isGameServiceError(error, "OWN_TAKEBACK"),
  );
});

// ---------------------------------------------------------------------------
// 6. Multiple accepted takebacks across new moves — state stays consistent
// ---------------------------------------------------------------------------
test("multiple accepted takebacks with moves in between stay consistent", async () => {
  const { service, alice, bob, gameId } = await setupGame();

  // Round 1: alice and bob each play
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

  // It's bob's turn. Alice requests takeback.
  // currentTurn=black, requester=white => single undo (alice's last move at 8,8).
  await service.applyAction(gameId, alice, { type: "request-takeback" });
  const afterFirst = await service.applyAction(gameId, bob, {
    type: "accept-takeback",
  });

  assert.equal(afterFirst.state.positions[9][9], "white", "alice first move kept");
  assert.equal(afterFirst.state.positions[10][10], "black", "bob's move kept");
  assert.equal(afterFirst.state.positions[8][8], null, "alice's second move undone");
  assert.equal(afterFirst.state.currentTurn, "white", "alice's turn again");
  assert.equal(afterFirst.state.history.length, 2, "2 moves in history");

  // Round 2: make more moves
  await service.applyAction(gameId, alice, {
    type: "place-piece",
    position: { x: 7, y: 7 },
  });
  await service.applyAction(gameId, bob, {
    type: "place-piece",
    position: { x: 11, y: 11 },
  });

  // It's alice's turn. Bob requests takeback.
  // currentTurn=white, requester=black => single undo (bob's last move at 11,11).
  await service.applyAction(gameId, bob, { type: "request-takeback" });
  const afterSecond = await service.applyAction(gameId, alice, {
    type: "accept-takeback",
  });

  assert.equal(afterSecond.state.positions[11][11], null, "bob's second move undone");
  assert.equal(afterSecond.state.positions[7][7], "white", "alice's move kept");
  assert.equal(afterSecond.state.currentTurn, "black", "bob's turn again");
  assert.equal(afterSecond.state.history.length, 3, "3 moves in history");

  // Game should still be fully playable
  const afterResume = await service.applyAction(gameId, bob, {
    type: "place-piece",
    position: { x: 12, y: 12 },
  });
  assert.equal(afterResume.state.positions[12][12], "black");
  assert.equal(afterResume.state.currentTurn, "white");
});

// ---------------------------------------------------------------------------
// 7. Undo pending jump steps one by one during a multi-hop jump
// ---------------------------------------------------------------------------
test("undo each hop of a multi-hop jump back to the start", async () => {
  const { service, alice, bob, gameId } = await setupGame();

  // Build a board where white can do a multi-hop jump.
  // Place black stones in a line with gaps for white to chain-jump:
  //   White at (5,9), Black at (6,9), empty at (7,9), Black at (8,9), empty at (9,9)
  // First place the pieces via normal moves (all interior positions).
  await service.applyAction(gameId, alice, {
    type: "place-piece",
    position: { x: 5, y: 9 },
  });
  await service.applyAction(gameId, bob, {
    type: "place-piece",
    position: { x: 6, y: 9 },
  });
  await service.applyAction(gameId, alice, {
    type: "place-piece",
    position: { x: 3, y: 3 },
  });
  await service.applyAction(gameId, bob, {
    type: "place-piece",
    position: { x: 8, y: 9 },
  });
  // One more pair to keep turns balanced
  await service.applyAction(gameId, alice, {
    type: "place-piece",
    position: { x: 4, y: 4 },
  });
  await service.applyAction(gameId, bob, {
    type: "place-piece",
    position: { x: 14, y: 14 },
  });

  // White jumps from (5,9) over (6,9) to (7,9) — hop 1
  const hop1 = await service.applyAction(gameId, alice, {
    type: "jump-piece",
    from: { x: 5, y: 9 },
    to: { x: 7, y: 9 },
  });
  assert.equal(hop1.state.pendingJump.length, 1);
  assert.equal(hop1.state.positions[9][5], null, "origin empty after hop 1");
  assert.equal(hop1.state.positions[9][7], "white", "white at (7,9) after hop 1");

  // White jumps from (7,9) over (8,9) to (9,9) — hop 2
  const hop2 = await service.applyAction(gameId, alice, {
    type: "jump-piece",
    from: { x: 7, y: 9 },
    to: { x: 9, y: 9 },
  });
  assert.equal(hop2.state.pendingJump.length, 2);
  assert.equal(hop2.state.positions[9][7], null, "(7,9) empty after hop 2");
  assert.equal(hop2.state.positions[9][9], "white", "white at (9,9) after hop 2");

  // Undo hop 2 — should restore white to (7,9), clear (9,9)
  const undoHop2 = await service.applyAction(gameId, alice, {
    type: "undo-pending-jump-step",
  });
  assert.equal(undoHop2.state.pendingJump.length, 1);
  assert.equal(undoHop2.state.positions[9][7], "white", "white back at (7,9)");
  assert.equal(undoHop2.state.positions[9][9], null, "(9,9) cleared");
  assert.equal(undoHop2.state.currentTurn, "white", "still white's turn");

  // Undo hop 1 — should restore white to (5,9), clear (7,9)
  const undoHop1 = await service.applyAction(gameId, alice, {
    type: "undo-pending-jump-step",
  });
  assert.equal(undoHop1.state.pendingJump.length, 0);
  assert.equal(undoHop1.state.positions[9][5], "white", "white restored at (5,9)");
  assert.equal(undoHop1.state.positions[9][7], null, "(7,9) cleared");
  assert.equal(undoHop1.state.currentTurn, "white", "still white's turn, can make another action");

  // Black pieces should still be on the board (captures only happen on confirm)
  assert.equal(undoHop1.state.positions[9][6], "black", "black at (6,9) still present");
  assert.equal(undoHop1.state.positions[9][8], "black", "black at (8,9) still present");
});
