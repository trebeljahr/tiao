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

test("listActiveGamesForPlayer returns waiting and active games only", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  // Create a waiting game (alice only)
  const waitingGame = await service.createGame(alice);

  // Create an active game (alice + bob)
  const activeGame = await service.createGame(alice);
  await service.joinGame(activeGame.gameId, bob);

  const games = await service.listActiveGamesForPlayer("alice");

  assert.equal(games.length, 2);

  const gameIds = games.map((g) => g.gameId);
  assert.ok(gameIds.includes(waitingGame.gameId), "Should include waiting game");
  assert.ok(gameIds.includes(activeGame.gameId), "Should include active game");

  // Verify structure of a game summary
  const active = games.find((g) => g.gameId === activeGame.gameId)!;
  assert.equal(active.status, "active");
  assert.equal(active.boardSize, 19);
  assert.equal(active.scoreToWin, 10);
  assert.ok(active.seats.white !== null || active.seats.black !== null);
  assert.ok(active.createdAt);
  assert.ok(active.updatedAt);

  const waiting = games.find((g) => g.gameId === waitingGame.gameId)!;
  assert.equal(waiting.status, "waiting");
});

test("listActiveGamesForPlayer excludes finished games", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  // Create a game and forfeit it to make it finished
  const game = await service.createGame(alice);
  await service.joinGame(game.gameId, bob);

  // alice is white (random = 0), forfeit as alice
  await service.applyAction(game.gameId, alice, { type: "forfeit" });

  const games = await service.listActiveGamesForPlayer("alice");
  const gameIds = games.map((g) => g.gameId);
  assert.ok(!gameIds.includes(game.gameId), "Should not include finished game");
});

test("listActiveGamesForPlayer returns empty array for player with no games", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);

  const games = await service.listActiveGamesForPlayer("nonexistent");
  assert.equal(games.length, 0);
});

test("listActiveGamesForPlayer includes score and time control info", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const game = await service.createGame(alice, {
    gameSettings: { boardSize: 9, scoreToWin: 5 },
    timeControl: { initialMs: 300_000, incrementMs: 5_000 },
  });
  await service.joinGame(game.gameId, bob);

  const games = await service.listActiveGamesForPlayer("alice");
  assert.equal(games.length, 1);

  const summary = games[0]!;
  assert.equal(summary.boardSize, 9);
  assert.equal(summary.scoreToWin, 5);
  assert.deepEqual(summary.timeControl, { initialMs: 300_000, incrementMs: 5_000 });
  assert.ok(summary.clockMs !== null);
  assert.equal(summary.score.white, 0);
  assert.equal(summary.score.black, 0);
});

test("InMemoryGameRoomStore.listActiveRoomsForPlayer filters correctly", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  // Create 3 games
  const g1 = await service.createGame(alice); // waiting
  const g2 = await service.createGame(alice); // will be active
  const g3 = await service.createGame(alice); // will be finished

  await service.joinGame(g2.gameId, bob);
  await service.joinGame(g3.gameId, bob);
  await service.applyAction(g3.gameId, alice, { type: "forfeit" });

  const rooms = await store.listActiveRoomsForPlayer("alice");
  const roomIds = rooms.map((r) => r.id);

  assert.ok(roomIds.includes(g1.gameId), "Should include waiting game");
  assert.ok(roomIds.includes(g2.gameId), "Should include active game");
  assert.ok(!roomIds.includes(g3.gameId), "Should not include finished game");
});
