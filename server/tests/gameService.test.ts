import assert from "node:assert/strict";
import { test, mock } from "node:test";
import WebSocket from "ws";
import type { PlayerIdentity } from "../../shared/src";
import { GameService, GameServiceError } from "../game/gameService";
import { InMemoryGameRoomStore } from "../game/gameStore";

function createPlayer(
  playerId: string,
  options: Partial<PlayerIdentity> = {}
): PlayerIdentity {
  return {
    playerId,
    displayName: options.displayName ?? playerId,
    kind: options.kind ?? "account",
    email: options.email,
    profilePicture: options.profilePicture,
  };
}

async function finishRoom(
  store: InMemoryGameRoomStore,
  roomId: string,
  winner: "white" | "black"
) {
  const room = await store.getRoom(roomId);
  assert.ok(room, "expected room to exist");
  room.state.score[winner] = 10;
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

function isGameServiceError(
  error: unknown,
  code: string
): error is GameServiceError {
  return error instanceof GameServiceError && error.code === code;
}

test("rooms persist across service instances and randomize seats on second join", async () => {
  const store = new InMemoryGameRoomStore();
  const creatorService = new GameService(store, () => 0.9);
  const reopenService = new GameService(store, () => 0.9);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const created = await creatorService.createGame(alice);
  assert.equal(created.status, "waiting");
  assert.equal(created.players.length, 1);
  assert.equal(created.seats.white, null);
  assert.equal(created.seats.black, null);

  await creatorService.joinGame(created.gameId, bob);

  const reopened = await reopenService.getSnapshot(created.gameId);

  assert.equal(reopened.gameId, created.gameId);
  assert.equal(reopened.status, "active");
  assert.equal(reopened.players.length, 2);
  assert.equal(reopened.seats.white?.player.playerId, bob.playerId);
  assert.equal(reopened.seats.black?.player.playerId, alice.playerId);
});

test("guest players can have multiple unfinished multiplayer games", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const guest = createPlayer("guest-1", { kind: "guest", displayName: "Guest" });
  const host = createPlayer("host");

  const firstGame = await service.createGame(guest);
  const secondGame = await service.createGame(guest);
  const hostGame = await service.createGame(host);

  // Guest can join another player's game while having open games
  const joined = await service.joinGame(hostGame.gameId, guest);
  assert.ok(joined);

  const reopened = await service.joinGame(firstGame.gameId, guest);
  assert.equal(reopened.gameId, firstGame.gameId);
});

test("account players can keep multiple active games and browse finished history", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");
  const carol = createPlayer("carol");

  const gameOne = await service.createGame(alice);
  await service.joinGame(gameOne.gameId, bob);

  const gameTwo = await service.createGame(carol);
  await service.joinGame(gameTwo.gameId, alice);

  await finishRoom(store, gameOne.gameId, "white");

  const library = await service.listGames(alice);

  assert.equal(library.active.length, 1);
  assert.equal(library.finished.length, 1);
  assert.equal(library.active[0]?.gameId, gameTwo.gameId);
  assert.equal(library.active[0]?.yourSeat, "black");
  assert.equal(library.finished[0]?.gameId, gameOne.gameId);
  assert.equal(library.finished[0]?.winner, "white");
});

test("game browsing works for guest players", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const guest = createPlayer("guest-2", { kind: "guest" });

  const result = await service.listGames(guest);
  assert.deepStrictEqual(result, { active: [], finished: [] });
});

test("spectator access opens a full game without taking a seat", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");
  const carol = createPlayer("carol");

  const created = await service.createGame(alice);
  const joined = await service.accessGame(created.gameId, bob);
  const spectated = await service.accessGame(created.gameId, carol);

  assert.equal(joined.status, "active");
  assert.equal(joined.players.length, 2);
  assert.equal(spectated.players.length, 2);
  assert.equal(
    spectated.players.some((slot) => slot.player.playerId === carol.playerId),
    false
  );
});

test("online seat indicators update when sockets connect and disconnect", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");
  const spectator = createPlayer("spectator");
  const created = await service.createGame(alice);

  await service.joinGame(created.gameId, bob);

  const aliceSocket = new FakeSocket() as unknown as WebSocket;
  const bobSocket = new FakeSocket() as unknown as WebSocket;
  const spectatorSocket = new FakeSocket() as unknown as WebSocket;

  await service.connect(created.gameId, alice, aliceSocket);
  let snapshot = await service.getSnapshot(created.gameId);
  assert.equal(snapshot.seats.white?.online, true);
  assert.equal(snapshot.seats.black?.online, false);

  await service.connect(created.gameId, bob, bobSocket);
  snapshot = await service.getSnapshot(created.gameId);
  assert.equal(snapshot.seats.white?.online, true);
  assert.equal(snapshot.seats.black?.online, true);

  await service.connect(created.gameId, spectator, spectatorSocket);
  snapshot = await service.getSnapshot(created.gameId);
  assert.equal(snapshot.seats.white?.online, true);
  assert.equal(snapshot.seats.black?.online, true);

  await service.disconnect(aliceSocket);
  snapshot = await service.getSnapshot(created.gameId);
  assert.equal(snapshot.seats.white?.online, false);
  assert.equal(snapshot.seats.black?.online, true);
});

test("matchmaking pairs the next two players into a live room", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const first = await service.enterMatchmaking(alice);
  assert.equal(first.status, "searching");

  const second = await service.enterMatchmaking(bob);
  assert.equal(second.status, "matched");
  assert.equal(second.snapshot.roomType, "matchmaking");
  assert.equal(second.snapshot.status, "active");
  assert.equal(second.snapshot.players.length, 2);

  const waitingPlayerState = await service.getMatchmakingState(alice);
  assert.equal(waitingPlayerState.status, "matched");
  assert.equal(waitingPlayerState.snapshot.gameId, second.snapshot.gameId);

  await service.leaveMatchmaking(alice);
  const cleared = await service.getMatchmakingState(alice);
  assert.equal(cleared.status, "idle");
});

test("rematches require both players and reshuffle seats when accepted", async () => {
  const store = new InMemoryGameRoomStore();
  const randomRolls = [0, 0.9];
  const service = new GameService(store, () => randomRolls.shift() ?? 0.9);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const created = await service.createGame(alice);
  const joined = await service.joinGame(created.gameId, bob);
  assert.equal(joined.seats.white?.player.playerId, alice.playerId);
  assert.equal(joined.seats.black?.player.playerId, bob.playerId);

  await finishRoom(store, created.gameId, "white");

  const requested = await service.applyAction(created.gameId, alice, {
    type: "request-rematch",
  });
  assert.deepEqual(requested.rematch?.requestedBy, ["white"]);
  assert.equal(requested.status, "finished");

  const accepted = await service.applyAction(created.gameId, bob, {
    type: "request-rematch",
  });
  assert.equal(accepted.status, "active");
  assert.equal(accepted.rematch, null);
  assert.equal(accepted.state.currentTurn, "white");
  assert.deepEqual(accepted.state.score, { black: 0, white: 0 });
  assert.equal(accepted.state.history.length, 0);
  assert.equal(accepted.seats.white?.player.playerId, bob.playerId);
  assert.equal(accepted.seats.black?.player.playerId, alice.playerId);
});

test("players can decline a rematch offer", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);
  await finishRoom(store, created.gameId, "white");

  const requested = await service.applyAction(created.gameId, alice, {
    type: "request-rematch",
  });
  assert.deepEqual(requested.rematch?.requestedBy, ["white"]);

  const declined = await service.applyAction(created.gameId, bob, {
    type: "decline-rematch",
  });
  assert.equal(declined.status, "finished");
  assert.equal(declined.rematch, null);
});

test("re-entering matchmaking after being matched puts the player in the queue for a new game", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");
  const carol = createPlayer("carol");

  // Alice searches, Bob matches with Alice
  await service.enterMatchmaking(alice);
  const matched = await service.enterMatchmaking(bob);
  assert.equal(matched.status, "matched");
  const firstGameId = matched.snapshot.gameId;

  // Alice re-enters matchmaking (went back to lobby)
  const reEntered = await service.enterMatchmaking(alice);
  assert.equal(reEntered.status, "searching");

  // The original game still exists and is accessible
  const originalGame = await service.getSnapshot(firstGameId);
  assert.equal(originalGame.status, "active");

  // Carol enters and should be matched with Alice into a NEW game
  const carolMatched = await service.enterMatchmaking(carol);
  assert.equal(carolMatched.status, "matched");
  assert.notEqual(carolMatched.snapshot.gameId, firstGameId);
});

test("guest game is abandoned after disconnect timeout expires", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });

  const store = new InMemoryGameRoomStore();
  const abandonTimeout = 5 * 60 * 1000;
  const service = new GameService(store, () => 0, abandonTimeout);
  const guest = createPlayer("guest-abandon", { kind: "guest", displayName: "Guest" });
  const alice = createPlayer("alice");

  const game = await service.createGame(alice);
  await service.joinGame(game.gameId, guest);

  const aliceSocket = new FakeSocket() as unknown as WebSocket;
  const guestSocket = new FakeSocket() as unknown as WebSocket;
  await service.connect(game.gameId, alice, aliceSocket);
  await service.connect(game.gameId, guest, guestSocket);

  // Guest disconnects
  await service.disconnect(guestSocket);
  let snapshot = await service.getSnapshot(game.gameId);
  assert.equal(snapshot.status, "active");

  // Advance time past the abandon timeout
  mock.timers.tick(abandonTimeout + 100);

  // Allow the async abandonGame callback to run
  await new Promise((resolve) => setImmediate(resolve));

  snapshot = await service.getSnapshot(game.gameId);
  assert.equal(snapshot.status, "finished");

  mock.timers.reset();
});

test("guest reconnecting before timeout cancels the abandon timer", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });

  const store = new InMemoryGameRoomStore();
  const abandonTimeout = 5 * 60 * 1000;
  const service = new GameService(store, () => 0, abandonTimeout);
  const guest = createPlayer("guest-reconnect", { kind: "guest", displayName: "Guest" });
  const alice = createPlayer("alice");

  const game = await service.createGame(alice);
  await service.joinGame(game.gameId, guest);

  const aliceSocket = new FakeSocket() as unknown as WebSocket;
  const guestSocket1 = new FakeSocket() as unknown as WebSocket;
  await service.connect(game.gameId, alice, aliceSocket);
  await service.connect(game.gameId, guest, guestSocket1);

  // Guest disconnects then reconnects before timeout
  await service.disconnect(guestSocket1);
  mock.timers.tick(2 * 60 * 1000); // 2 minutes

  const guestSocket2 = new FakeSocket() as unknown as WebSocket;
  await service.connect(game.gameId, guest, guestSocket2);

  // Advance past original timeout
  mock.timers.tick(4 * 60 * 1000);
  await new Promise((resolve) => setImmediate(resolve));

  const snapshot = await service.getSnapshot(game.gameId);
  assert.equal(snapshot.status, "active");

  mock.timers.reset();
});

test("account player disconnect does not trigger abandon timer", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });

  const store = new InMemoryGameRoomStore();
  const abandonTimeout = 5 * 60 * 1000;
  const service = new GameService(store, () => 0, abandonTimeout);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const game = await service.createGame(alice);
  await service.joinGame(game.gameId, bob);

  const aliceSocket = new FakeSocket() as unknown as WebSocket;
  const bobSocket = new FakeSocket() as unknown as WebSocket;
  await service.connect(game.gameId, alice, aliceSocket);
  await service.connect(game.gameId, bob, bobSocket);

  // Account player disconnects
  await service.disconnect(bobSocket);
  mock.timers.tick(abandonTimeout + 100);
  await new Promise((resolve) => setImmediate(resolve));

  const snapshot = await service.getSnapshot(game.gameId);
  assert.equal(snapshot.status, "active");

  mock.timers.reset();
});

test("finished games include full move history in snapshots", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const game = await service.createGame(alice);
  await service.joinGame(game.gameId, bob);

  // Make moves (alice is white with seatRandom=0)
  await service.applyAction(game.gameId, alice, {
    type: "place-piece",
    position: { x: 9, y: 9 },
  });

  await service.applyAction(game.gameId, bob, {
    type: "place-piece",
    position: { x: 10, y: 10 },
  });

  await finishRoom(store, game.gameId, "white");

  const snapshot = await service.getSnapshot(game.gameId);
  assert.equal(snapshot.status, "finished");
  assert.equal(snapshot.state.history.length, 2);
  assert.equal(snapshot.state.history[0].type, "put");
  assert.equal(snapshot.state.history[1].type, "put");
});

test("accessGame on a finished game returns complete move history", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");
  const reviewer = createPlayer("reviewer");

  const game = await service.createGame(alice);
  await service.joinGame(game.gameId, bob);

  await service.applyAction(game.gameId, alice, {
    type: "place-piece",
    position: { x: 9, y: 9 },
  });

  await finishRoom(store, game.gameId, "white");

  const snapshot = await service.accessGame(game.gameId, reviewer);
  assert.equal(snapshot.state.history.length, 1);
  assert.deepEqual(snapshot.state.history[0].type, "put");
});

test("spectators appear in snapshot when connected via WebSocket", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");
  const carol = createPlayer("carol", { displayName: "Carol" });

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);

  // Before any spectator connects, spectators list is empty
  let snapshot = await service.getSnapshot(created.gameId);
  assert.equal(snapshot.spectators.length, 0);

  // Connect carol as a spectator (she's not in room.players)
  const carolSocket = new FakeSocket() as unknown as WebSocket;
  await service.connect(created.gameId, carol, carolSocket);

  snapshot = await service.getSnapshot(created.gameId);
  assert.equal(snapshot.spectators.length, 1);
  assert.equal(snapshot.spectators[0].player.playerId, "carol");
  assert.equal(snapshot.spectators[0].player.displayName, "Carol");
  assert.equal(snapshot.spectators[0].online, true);

  // Players still only has alice and bob
  assert.equal(snapshot.players.length, 2);
});

test("spectator is removed from snapshot after disconnect", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");
  const carol = createPlayer("carol");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);

  const carolSocket = new FakeSocket() as unknown as WebSocket;
  await service.connect(created.gameId, carol, carolSocket);

  let snapshot = await service.getSnapshot(created.gameId);
  assert.equal(snapshot.spectators.length, 1);

  await service.disconnect(carolSocket);
  snapshot = await service.getSnapshot(created.gameId);
  assert.equal(snapshot.spectators.length, 0);
});

test("multiple spectators tracked independently", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");
  const carol = createPlayer("carol");
  const dave = createPlayer("dave");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);

  const carolSocket = new FakeSocket() as unknown as WebSocket;
  const daveSocket = new FakeSocket() as unknown as WebSocket;
  await service.connect(created.gameId, carol, carolSocket);
  await service.connect(created.gameId, dave, daveSocket);

  let snapshot = await service.getSnapshot(created.gameId);
  assert.equal(snapshot.spectators.length, 2);
  const spectatorIds = snapshot.spectators.map((s) => s.player.playerId).sort();
  assert.deepEqual(spectatorIds, ["carol", "dave"]);

  // Disconnect carol, dave remains
  await service.disconnect(carolSocket);
  snapshot = await service.getSnapshot(created.gameId);
  assert.equal(snapshot.spectators.length, 1);
  assert.equal(snapshot.spectators[0].player.playerId, "dave");
});

test("spectator with multiple sockets stays until all sockets disconnect", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");
  const carol = createPlayer("carol");

  const created = await service.createGame(alice);
  await service.joinGame(created.gameId, bob);

  const carolSocket1 = new FakeSocket() as unknown as WebSocket;
  const carolSocket2 = new FakeSocket() as unknown as WebSocket;
  await service.connect(created.gameId, carol, carolSocket1);
  await service.connect(created.gameId, carol, carolSocket2);

  let snapshot = await service.getSnapshot(created.gameId);
  // Still only one spectator entry (same player)
  assert.equal(snapshot.spectators.length, 1);

  // Disconnect first socket, carol should still be listed
  await service.disconnect(carolSocket1);
  snapshot = await service.getSnapshot(created.gameId);
  assert.equal(snapshot.spectators.length, 1);
  assert.equal(snapshot.spectators[0].online, true);

  // Disconnect second socket, carol should be gone
  await service.disconnect(carolSocket2);
  snapshot = await service.getSnapshot(created.gameId);
  assert.equal(snapshot.spectators.length, 0);
});

test("players are not listed as spectators when they connect", async () => {
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

  const snapshot = await service.getSnapshot(created.gameId);
  assert.equal(snapshot.spectators.length, 0);
  assert.equal(snapshot.players.length, 2);
});
