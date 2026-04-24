import assert from "node:assert/strict";
import { test } from "node:test";
import WebSocket from "ws";
import type { PlayerIdentity, ServerToClientMessage, TimeControl } from "../../shared/src";
import { SCORE_TO_WIN } from "../../shared/src";
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
  readyState: number = WebSocket.OPEN;
  messages: string[] = [];
  private listeners: Record<string, Array<(...args: any[]) => void>> = {};

  send(message: string) {
    this.messages.push(message);
  }

  on(event: string, handler: (...args: any[]) => void) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  }

  emit(event: string, ...args: any[]) {
    for (const handler of this.listeners[event] ?? []) handler(...args);
  }

  get parsedMessages(): ServerToClientMessage[] {
    return this.messages.map((m) => JSON.parse(m));
  }
}

const BULLET_TC: TimeControl = { initialMs: 60_000, incrementMs: 0 };

function isGameServiceError(error: unknown, code: string): error is GameServiceError {
  return error instanceof GameServiceError && error.code === code;
}

async function finishRoom(store: InMemoryGameRoomStore, roomId: string, winner: "white" | "black") {
  const room = await store.getRoom(roomId);
  assert.ok(room, "expected room to exist");
  room.state.score[winner] = SCORE_TO_WIN;
  room.status = "finished";
  await store.saveRoom(room);
}

/** Helper: create a matchmaking game, return gameId and snapshot */
async function createMatchmakingGame(
  service: GameService,
  alice: PlayerIdentity,
  bob: PlayerIdentity,
  timeControl: TimeControl | null,
) {
  await service.enterMatchmaking(alice, timeControl);
  const matched = await service.enterMatchmaking(bob, timeControl);
  assert.ok(matched.status === "matched");
  return matched.snapshot;
}

/** Helper: finish a game and perform a rematch, returning the new game ID */
async function finishAndRematch(
  service: GameService,
  _store: InMemoryGameRoomStore,
  gameId: string,
  alice: PlayerIdentity,
  bob: PlayerIdentity,
): Promise<string> {
  await service.testForceFinishGame(gameId, "white");

  const aliceSocket = new FakeSocket() as unknown as WebSocket;
  await service.connect(gameId, alice, aliceSocket);
  (aliceSocket as unknown as FakeSocket).messages = [];

  await service.applyAction(gameId, alice, { type: "request-rematch" });
  await service.applyAction(gameId, bob, { type: "request-rematch" });

  const rematchMsg = (aliceSocket as unknown as FakeSocket).parsedMessages.find(
    (m) => m.type === "rematch-started",
  );
  assert.ok(
    rematchMsg && rematchMsg.type === "rematch-started",
    "expected rematch-started message",
  );
  return rematchMsg.gameId;
}

// ---------------------------------------------------------------------------
// First Move Timer Edge Cases
// ---------------------------------------------------------------------------

test("untimed matchmaking game has no firstMoveDeadline", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const snapshot = await createMatchmakingGame(service, alice, bob, null);

  assert.equal(
    snapshot.firstMoveDeadline,
    null,
    "untimed matchmaking game should not set a firstMoveDeadline",
  );
  assert.equal(snapshot.clock, null, "untimed game should have no clock");
});

test("direct (non-matchmaking) timed game has no firstMoveDeadline", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const created = await service.createGame(alice, { timeControl: BULLET_TC });
  const joined = await service.joinGame(created.gameId, bob);

  // Direct games don't set firstMoveDeadline even with time control —
  // only matchmaking games set it since both players are guaranteed present.
  assert.equal(
    joined.firstMoveDeadline,
    null,
    "direct timed game should not set firstMoveDeadline",
  );
  assert.ok(joined.clock, "direct timed game should still have a clock");
  assert.equal(joined.clock!.white, BULLET_TC.initialMs);
  assert.equal(joined.clock!.black, BULLET_TC.initialMs);
});

test("first move clears the firstMoveDeadline in snapshot", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const snapshot = await createMatchmakingGame(service, alice, bob, BULLET_TC);
  assert.ok(snapshot.firstMoveDeadline, "should have firstMoveDeadline before first move");

  // Alice is white (random = 0), make the first move
  const afterMove = await service.applyAction(snapshot.gameId, alice, {
    type: "place-piece",
    position: { x: 9, y: 9 },
  });

  assert.equal(
    afterMove.firstMoveDeadline,
    null,
    "firstMoveDeadline should be null after first move",
  );

  // Also verify via getSnapshot
  const freshSnapshot = await service.getSnapshot(snapshot.gameId);
  assert.equal(
    freshSnapshot.firstMoveDeadline,
    null,
    "getSnapshot should also show null deadline after first move",
  );
});

test("clocks stay at initial values before first move", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const snapshot = await createMatchmakingGame(service, alice, bob, BULLET_TC);

  assert.ok(snapshot.clock, "clock should be present");
  assert.equal(snapshot.clock.white, BULLET_TC.initialMs, "white clock should be at initial value");
  assert.equal(snapshot.clock.black, BULLET_TC.initialMs, "black clock should be at initial value");

  // Fetch again after a small delay to make sure clocks are truly frozen
  const freshSnapshot = await service.getSnapshot(snapshot.gameId);
  assert.ok(freshSnapshot.clock, "clock should still be present");
  assert.equal(
    freshSnapshot.clock.white,
    BULLET_TC.initialMs,
    "white clock should remain at initial value",
  );
  assert.equal(
    freshSnapshot.clock.black,
    BULLET_TC.initialMs,
    "black clock should remain at initial value",
  );
});

// ---------------------------------------------------------------------------
// Rematch Edge Cases
// ---------------------------------------------------------------------------

test("rematch assigns both players to valid seats", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);
  await finishRoom(store, created.gameId, "white");

  const aliceSocket = new FakeSocket() as unknown as WebSocket;
  await service.connect(created.gameId, alice, aliceSocket);
  (aliceSocket as unknown as FakeSocket).messages = [];

  await service.applyAction(created.gameId, alice, { type: "request-rematch" });
  await service.applyAction(created.gameId, bob, { type: "request-rematch" });

  const rematchMsg = (aliceSocket as unknown as FakeSocket).parsedMessages.find(
    (m) => m.type === "rematch-started",
  );
  assert.ok(rematchMsg && rematchMsg.type === "rematch-started");

  const newSnapshot = await service.getSnapshot(rematchMsg.gameId);
  assert.equal(newSnapshot.status, "active");
  assert.ok(newSnapshot.seats.white, "white seat should be assigned in rematch");
  assert.ok(newSnapshot.seats.black, "black seat should be assigned in rematch");

  // Both players should be present
  const playerIds = newSnapshot.players.map((p) => p.player.playerId).sort();
  assert.deepEqual(playerIds, ["alice", "bob"]);

  // Each seat should reference one of the two players
  const whiteId = newSnapshot.seats.white!.player.playerId;
  const blackId = newSnapshot.seats.black!.player.playerId;
  assert.ok(["alice", "bob"].includes(whiteId));
  assert.ok(["alice", "bob"].includes(blackId));
  assert.notEqual(whiteId, blackId, "white and black should be different players");
});

test("rematch creates a new independent game with fresh state but preserved settings", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  // Create a timed matchmaking game so we can verify timeControl is preserved
  const snapshot = await createMatchmakingGame(service, alice, bob, BULLET_TC);
  const originalGameId = snapshot.gameId;
  const originalBoardSize = snapshot.state.boardSize;
  const originalScoreToWin = snapshot.state.scoreToWin;

  // Make a move so board is not empty
  await service.applyAction(originalGameId, alice, {
    type: "place-piece",
    position: { x: 9, y: 9 },
  });

  // Force finish and rematch
  const newGameId = await finishAndRematch(service, store, originalGameId, alice, bob);

  assert.notEqual(newGameId, originalGameId, "rematch should have a different game ID");

  const newSnapshot = await service.getSnapshot(newGameId);
  assert.equal(newSnapshot.status, "active", "new game should be active");

  // Fresh state
  assert.deepEqual(newSnapshot.state.score, { black: 0, white: 0 }, "score should be 0-0");
  assert.equal(newSnapshot.state.history.length, 0, "history should be empty");
  assert.equal(newSnapshot.state.currentTurn, "white", "white should move first");

  // Board should be empty (no positions occupied)
  const hasAnyPiece = newSnapshot.state.positions.some((row) => row.some((cell) => cell !== null));
  assert.ok(!hasAnyPiece, "board should be empty in rematch");

  // Settings preserved
  assert.equal(newSnapshot.state.boardSize, originalBoardSize, "boardSize should be preserved");
  assert.equal(newSnapshot.state.scoreToWin, originalScoreToWin, "scoreToWin should be preserved");
  assert.ok(newSnapshot.timeControl, "timeControl should be preserved");
  assert.equal(newSnapshot.timeControl!.initialMs, BULLET_TC.initialMs, "initialMs should match");
  assert.equal(
    newSnapshot.timeControl!.incrementMs,
    BULLET_TC.incrementMs,
    "incrementMs should match",
  );
});

test("single-sided rematch request sets requestedBy with one entry", async () => {
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

  assert.equal(afterRequest.status, "finished", "game should still be finished");
  assert.ok(afterRequest.rematch, "rematch should be set");
  assert.equal(
    afterRequest.rematch!.requestedBy.length,
    1,
    "only one player should have requested",
  );

  // Alice requests again — should be idempotent (still one entry, not duplicated)
  const afterDuplicate = await service.applyAction(created.gameId, alice, {
    type: "request-rematch",
  });

  assert.ok(afterDuplicate.rematch, "rematch should still be set");
  assert.equal(
    afterDuplicate.rematch!.requestedBy.length,
    1,
    "duplicate request should not add a second entry",
  );
});

test("rematch after multiple games produces independent games each time", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  // Game 1: via matchmaking
  const game1Snapshot = await createMatchmakingGame(service, alice, bob, BULLET_TC);
  const game1Id = game1Snapshot.gameId;

  // Finish game 1, rematch to game 2
  const game2Id = await finishAndRematch(service, store, game1Id, alice, bob);
  assert.notEqual(game2Id, game1Id, "game 2 should differ from game 1");

  // Verify game 2 is fresh
  const game2Snapshot = await service.getSnapshot(game2Id);
  assert.equal(game2Snapshot.status, "active");
  assert.deepEqual(game2Snapshot.state.score, { black: 0, white: 0 });
  assert.equal(game2Snapshot.state.history.length, 0);

  // Finish game 2, rematch to game 3
  const game3Id = await finishAndRematch(service, store, game2Id, alice, bob);
  assert.notEqual(game3Id, game2Id, "game 3 should differ from game 2");
  assert.notEqual(game3Id, game1Id, "game 3 should differ from game 1");

  // Verify game 3 is fresh
  const game3Snapshot = await service.getSnapshot(game3Id);
  assert.equal(game3Snapshot.status, "active");
  assert.deepEqual(game3Snapshot.state.score, { black: 0, white: 0 });
  assert.equal(game3Snapshot.state.history.length, 0);

  // All three games should be independently retrievable
  const g1 = await service.getSnapshot(game1Id);
  const g2 = await service.getSnapshot(game2Id);
  const g3 = await service.getSnapshot(game3Id);
  assert.equal(g1.status, "finished");
  assert.equal(g2.status, "finished");
  assert.equal(g3.status, "active");
});

test("cannot request rematch on a non-finished (active) game", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);

  // Game is active — rematch should be rejected
  await assert.rejects(
    () =>
      service.applyAction(created.gameId, alice, {
        type: "request-rematch",
      }),
    (error) => isGameServiceError(error, "GAME_NOT_FINISHED"),
  );
});

test("cannot request rematch on a waiting game", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");

  const created = await service.createGame(alice);

  // Game is in "waiting" status — no opponent yet
  await assert.rejects(
    () =>
      service.applyAction(created.gameId, alice, {
        type: "request-rematch",
      }),
    (error) => isGameServiceError(error, "GAME_NOT_FINISHED"),
  );
});

// ---------------------------------------------------------------------------
// pushPendingRematches on lobby connect
// ---------------------------------------------------------------------------

test("pushes pending incoming rematch game-update to newly connected lobby socket", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);
  await finishRoom(store, created.gameId, "white");

  // Alice requests rematch (bob has NOT requested)
  await service.applyAction(created.gameId, alice, { type: "request-rematch" });

  // Bob connects to lobby — should receive the pending rematch
  const bobLobbySocket = new FakeSocket() as unknown as WebSocket;
  await service.connectLobby(bob, bobLobbySocket);

  // Give async push time to execute
  await new Promise((r) => setTimeout(r, 50));

  const messages = (bobLobbySocket as unknown as FakeSocket).parsedMessages;
  const gameUpdates = messages.filter((m) => (m as any).type === "game-update");
  assert.ok(gameUpdates.length >= 1, "bob should receive at least one game-update on connect");

  const rematchUpdate = gameUpdates.find(
    (m) => (m as any).summary?.gameId === created.gameId,
  ) as any;
  assert.ok(rematchUpdate, "game-update should contain the game with pending rematch");
  assert.equal(rematchUpdate.summary.status, "finished");
  assert.ok(rematchUpdate.summary.rematch?.requestedBy?.length > 0, "rematch should be pending");
});

test("does not push own outgoing rematch requests on lobby connect", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);
  await finishRoom(store, created.gameId, "white");

  // Alice requests rematch
  await service.applyAction(created.gameId, alice, { type: "request-rematch" });

  // Wait for the fire-and-forget lobby broadcasts from applyAction to settle
  await new Promise((r) => setTimeout(r, 50));

  // Alice connects to lobby — should NOT receive her own outgoing rematch
  const aliceLobbySocket = new FakeSocket() as unknown as WebSocket;
  await service.connectLobby(alice, aliceLobbySocket);

  await new Promise((r) => setTimeout(r, 50));

  const messages = (aliceLobbySocket as unknown as FakeSocket).parsedMessages;
  const gameUpdates = messages.filter(
    (m) => (m as any).type === "game-update" && (m as any).summary?.gameId === created.gameId,
  );
  assert.equal(
    gameUpdates.length,
    0,
    "alice should NOT receive game-update for her own outgoing rematch",
  );
});

// ---------------------------------------------------------------------------
// cancelRematchViaRest
// ---------------------------------------------------------------------------

test("cancelRematchViaRest cancels a pending rematch request", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);
  await finishRoom(store, created.gameId, "white");

  // Alice requests rematch
  await service.applyAction(created.gameId, alice, { type: "request-rematch" });

  // Verify rematch is pending
  let snapshot = await service.getSnapshot(created.gameId);
  assert.ok(snapshot.rematch?.requestedBy.length, "rematch should be pending");

  // Cancel via REST
  await service.cancelRematchViaRest(created.gameId, alice);

  // Verify rematch is cleared
  snapshot = await service.getSnapshot(created.gameId);
  assert.equal(snapshot.rematch, null, "rematch should be null after cancel");
});

test("cancelRematchViaRest rejects when player is not in game", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");
  const charlie = createPlayer("charlie");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);
  await finishRoom(store, created.gameId, "white");

  await service.applyAction(created.gameId, alice, { type: "request-rematch" });

  await assert.rejects(
    () => service.cancelRematchViaRest(created.gameId, charlie),
    (error) => isGameServiceError(error, "NOT_IN_GAME"),
  );
});

// ---------------------------------------------------------------------------
// Issue #144 — sender disconnect → revoke → reconnect should not resurrect
// ---------------------------------------------------------------------------

test("rematch is revoked end-to-end when sender fully disconnects and reconnects", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);
  await finishRoom(store, created.gameId, "white");

  // Alice opens the game page (game socket) AND the lobby socket
  const aliceGameSocket = new FakeSocket() as unknown as WebSocket;
  await service.connect(created.gameId, alice, aliceGameSocket);
  const aliceLobbySocket = new FakeSocket() as unknown as WebSocket;
  await service.connectLobby(alice, aliceLobbySocket);

  // Alice requests a rematch from the game page
  await service.applyAction(created.gameId, alice, { type: "request-rematch" });

  let snapshot = await service.getSnapshot(created.gameId);
  assert.ok(snapshot.rematch?.requestedBy.length, "rematch should be pending after request");

  // Alice closes the browser entirely — both her game socket AND lobby socket
  // tear down. Order is intentionally lobby-first to mirror the trickier branch
  // (the per-room handler will see rematch already null and must not resurrect).
  (aliceLobbySocket as unknown as FakeSocket).readyState = WebSocket.CLOSED;
  (aliceLobbySocket as unknown as FakeSocket).emit("close");
  await service.disconnect(aliceGameSocket);

  // Give the fire-and-forget revocation lock + broadcasts time to settle
  await new Promise((r) => setTimeout(r, 50));

  // The room should have rematch cleared
  snapshot = await service.getSnapshot(created.gameId);
  assert.equal(snapshot.rematch, null, "rematch should be revoked after disconnect");

  // listGames for alice should reflect the cleared state — no dangling rematch
  // would show in her lobby on reconnect.
  const aliceGames = await service.listGames(alice);
  const aliceFinished = aliceGames.finished.find((g) => g.gameId === created.gameId);
  assert.ok(aliceFinished, "alice should still see the finished game in her list");
  assert.equal(aliceFinished.rematch, null, "alice's lobby view should not show a rematch");

  // listGames for bob should also be clean
  const bobGames = await service.listGames(bob);
  const bobFinished = bobGames.finished.find((g) => g.gameId === created.gameId);
  assert.ok(bobFinished, "bob should still see the finished game in his list");
  assert.equal(bobFinished.rematch, null, "bob's lobby view should not show a rematch");

  // When alice reconnects her lobby socket, pushPendingRematches must NOT
  // re-deliver the cleared rematch as an incoming notification.
  const aliceReconnectSocket = new FakeSocket() as unknown as WebSocket;
  await service.connectLobby(alice, aliceReconnectSocket);
  await new Promise((r) => setTimeout(r, 50));

  const aliceMessages = (aliceReconnectSocket as unknown as FakeSocket).parsedMessages;
  const aliceRematchPushes = aliceMessages.filter(
    (m) =>
      (m as { type?: string }).type === "game-update" &&
      (m as { summary?: { gameId?: string; rematch?: { requestedBy?: string[] } } }).summary
        ?.gameId === created.gameId &&
      ((m as { summary?: { rematch?: { requestedBy?: string[] } } }).summary?.rematch?.requestedBy
        ?.length ?? 0) > 0,
  );
  assert.equal(
    aliceRematchPushes.length,
    0,
    "alice should not see her own stale rematch on lobby reconnect",
  );

  // And bob's reconnect should also be clean — no resurrected toast.
  const bobReconnectSocket = new FakeSocket() as unknown as WebSocket;
  await service.connectLobby(bob, bobReconnectSocket);
  await new Promise((r) => setTimeout(r, 50));

  const bobMessages = (bobReconnectSocket as unknown as FakeSocket).parsedMessages;
  const bobRematchPushes = bobMessages.filter(
    (m) =>
      (m as { type?: string }).type === "game-update" &&
      (m as { summary?: { gameId?: string; rematch?: { requestedBy?: string[] } } }).summary
        ?.gameId === created.gameId &&
      ((m as { summary?: { rematch?: { requestedBy?: string[] } } }).summary?.rematch?.requestedBy
        ?.length ?? 0) > 0,
  );
  assert.equal(
    bobRematchPushes.length,
    0,
    "bob should not receive a stale incoming rematch toast on reconnect",
  );
});

test("rematch is revoked when the receiver disconnects (not just the sender)", async () => {
  // Symmetrical to the test above: alice sends, BOB leaves. The previous
  // implementation only cleared the rematch on sender-disconnect, leaving the
  // receiver's pending request in the DB — which then resurrected as a toast
  // when bob came back online.
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);
  await finishRoom(store, created.gameId, "white");

  // Alice (sender) is connected to the game socket and her lobby socket
  const aliceGameSocket = new FakeSocket() as unknown as WebSocket;
  await service.connect(created.gameId, alice, aliceGameSocket);
  const aliceLobbySocket = new FakeSocket() as unknown as WebSocket;
  await service.connectLobby(alice, aliceLobbySocket);

  // Bob (receiver) is connected to the lobby (and would normally receive the
  // toast there). He has no game-page socket — he's just sitting on the lobby.
  const bobLobbySocket = new FakeSocket() as unknown as WebSocket;
  await service.connectLobby(bob, bobLobbySocket);

  // Alice requests a rematch
  await service.applyAction(created.gameId, alice, { type: "request-rematch" });
  await new Promise((r) => setTimeout(r, 20));

  let snapshot = await service.getSnapshot(created.gameId);
  assert.ok(snapshot.rematch?.requestedBy.length, "rematch should be pending after request");

  // Bob closes the browser entirely — only his lobby socket exists, so close it
  (bobLobbySocket as unknown as FakeSocket).readyState = WebSocket.CLOSED;
  (bobLobbySocket as unknown as FakeSocket).emit("close");
  await new Promise((r) => setTimeout(r, 50));

  // The rematch must be cleared even though bob never requested it
  snapshot = await service.getSnapshot(created.gameId);
  assert.equal(snapshot.rematch, null, "rematch should be revoked when the receiver disconnects");

  // When bob reconnects his lobby socket, pushPendingRematches must NOT
  // resurface the (now-cleared) rematch as a fresh toast.
  const bobReconnectSocket = new FakeSocket() as unknown as WebSocket;
  await service.connectLobby(bob, bobReconnectSocket);
  await new Promise((r) => setTimeout(r, 50));

  const bobMessages = (bobReconnectSocket as unknown as FakeSocket).parsedMessages;
  const bobRematchPushes = bobMessages.filter(
    (m) =>
      (m as { type?: string }).type === "game-update" &&
      (m as { summary?: { gameId?: string; rematch?: { requestedBy?: string[] } } }).summary
        ?.gameId === created.gameId &&
      ((m as { summary?: { rematch?: { requestedBy?: string[] } } }).summary?.rematch?.requestedBy
        ?.length ?? 0) > 0,
  );
  assert.equal(
    bobRematchPushes.length,
    0,
    "bob should not see a resurrected rematch toast after coming back online",
  );

  // Alice's lobby view (listGames) should also reflect rematch=null so her
  // "waiting for opponent" UI doesn't dangle indefinitely.
  const aliceGames = await service.listGames(alice);
  const aliceFinished = aliceGames.finished.find((g) => g.gameId === created.gameId);
  assert.ok(aliceFinished, "alice should still see the finished game in her list");
  assert.equal(
    aliceFinished.rematch,
    null,
    "alice's outgoing rematch should be cleared when bob leaves",
  );
});

test("both players receive a game-update for the OLD room when rematch is accepted", async () => {
  // Regression: the accepter's lobby "notifications" bubble (driven by
  // incomingRematchGameIds) would get stuck on the old gameId after accepting
  // a rematch from the lobby, because the server only broadcast game-update
  // for the NEW room, never for the OLD one with rematch=null. Now accept
  // mirrors decline/cancel and broadcasts an old-room game-update too.
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);
  await finishRoom(store, created.gameId, "white");

  // Alice requests the rematch first.
  await service.applyAction(created.gameId, alice, { type: "request-rematch" });
  // Let the initial request's fire-and-forget lobby broadcasts settle so we
  // can isolate the acceptance broadcasts below.
  await new Promise((r) => setTimeout(r, 50));

  // Both players are on the lobby when the rematch is accepted.
  const aliceLobbySocket = new FakeSocket() as unknown as WebSocket;
  const bobLobbySocket = new FakeSocket() as unknown as WebSocket;
  await service.connectLobby(alice, aliceLobbySocket);
  await service.connectLobby(bob, bobLobbySocket);
  await new Promise((r) => setTimeout(r, 50));
  (aliceLobbySocket as unknown as FakeSocket).messages = [];
  (bobLobbySocket as unknown as FakeSocket).messages = [];

  // Bob accepts the rematch.
  await service.applyAction(created.gameId, bob, { type: "request-rematch" });
  await new Promise((r) => setTimeout(r, 50));

  for (const [who, socket] of [
    ["alice", aliceLobbySocket],
    ["bob", bobLobbySocket],
  ] as const) {
    const updates = (socket as unknown as FakeSocket).parsedMessages.filter(
      (m) => (m as any).type === "game-update",
    );
    const oldRoomUpdate = updates.find((m) => (m as any).summary?.gameId === created.gameId) as any;
    assert.ok(
      oldRoomUpdate,
      `${who} should receive a game-update for the OLD room after rematch accept`,
    );
    assert.equal(
      oldRoomUpdate.summary.rematch,
      null,
      `${who}'s old-room game-update should show rematch cleared`,
    );
  }
});
