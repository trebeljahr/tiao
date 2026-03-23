import assert from "node:assert/strict";
import { test } from "node:test";
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

test("rooms persist across service instances and can be reopened", async () => {
  const store = new InMemoryGameRoomStore();
  const creatorService = new GameService(store);
  const reopenService = new GameService(store);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const created = await creatorService.createGame(alice);
  await creatorService.joinGame(created.gameId, bob);

  const reopened = await reopenService.getSnapshot(created.gameId);

  assert.equal(reopened.gameId, created.gameId);
  assert.equal(reopened.status, "active");
  assert.equal(reopened.seats.white?.player.playerId, alice.playerId);
  assert.equal(reopened.seats.black?.player.playerId, bob.playerId);
});

test("guest players are limited to one unfinished multiplayer game", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store);
  const guest = createPlayer("guest-1", { kind: "guest", displayName: "Guest" });
  const host = createPlayer("host");

  const firstGame = await service.createGame(guest);
  const hostGame = await service.createGame(host);

  await assert.rejects(
    () => service.createGame(guest),
    (error) => isGameServiceError(error, "GUEST_ACTIVE_GAME_LIMIT")
  );

  await assert.rejects(
    () => service.joinGame(hostGame.gameId, guest),
    (error) => isGameServiceError(error, "GUEST_ACTIVE_GAME_LIMIT")
  );

  const reopened = await service.joinGame(firstGame.gameId, guest);
  assert.equal(reopened.gameId, firstGame.gameId);
});

test("account players can keep multiple active games and browse finished history", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store);
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

test("game browsing is restricted to account players", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store);
  const guest = createPlayer("guest-2", { kind: "guest" });

  await assert.rejects(
    () => service.listGames(guest),
    (error) => isGameServiceError(error, "ACCOUNT_REQUIRED")
  );
});

test("online seat indicators update when sockets connect and disconnect", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");
  const created = await service.createGame(alice);

  await service.joinGame(created.gameId, bob);

  const aliceSocket = new FakeSocket() as unknown as WebSocket;
  const bobSocket = new FakeSocket() as unknown as WebSocket;

  await service.connect(created.gameId, alice, aliceSocket);
  let snapshot = await service.getSnapshot(created.gameId);
  assert.equal(snapshot.seats.white?.online, true);
  assert.equal(snapshot.seats.black?.online, false);

  await service.connect(created.gameId, bob, bobSocket);
  snapshot = await service.getSnapshot(created.gameId);
  assert.equal(snapshot.seats.white?.online, true);
  assert.equal(snapshot.seats.black?.online, true);

  await service.disconnect(aliceSocket);
  snapshot = await service.getSnapshot(created.gameId);
  assert.equal(snapshot.seats.white?.online, false);
  assert.equal(snapshot.seats.black?.online, true);
});
