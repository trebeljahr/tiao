import assert from "node:assert/strict";
import { test } from "node:test";
import WebSocket from "ws";
import type { PlayerIdentity } from "../../shared/src";
import { GameService } from "../game/gameService";
import { InMemoryGameRoomStore } from "../game/gameStore";

// NB: we intentionally don't mock achievementService here — this test never
// finishes a game, so the game-completed achievement hooks never fire.

function createPlayer(playerId: string): PlayerIdentity {
  return {
    playerId,
    displayName: playerId,
    kind: "account",
  };
}

/**
 * Minimal WebSocket stub that captures the server's registered event
 * listeners and exposes a `triggerClose()` method to simulate the client
 * disconnecting. Necessary because `gameService.connectLobby` attaches a
 * `close` handler via `socket.on("close", ...)` that's where the cleanup
 * logic lives — and we need to fire it deterministically in the test.
 */
class FakeSocket {
  readyState: number = WebSocket.OPEN;
  private handlers = new Map<string, Array<(...args: unknown[]) => void>>();

  on(event: string, handler: (...args: unknown[]) => void): this {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return this;
  }

  send(_message: string): void {
    /* test stub — no-op */
  }

  close(): void {
    this.triggerClose(1000, "test close");
  }

  triggerClose(code = 1000, reason = ""): void {
    this.readyState = WebSocket.CLOSED;
    const handlers = this.handlers.get("close") ?? [];
    const reasonBuffer = Buffer.from(reason);
    for (const h of handlers) h(code, reasonBuffer);
  }
}

/**
 * Regression test for cleanup of the two in-memory state Maps that grow
 * on lobby connect:
 *
 *   - `lobbyConnections: Map<playerId, Set<WebSocket>>`
 *   - `matchmakingSocketByPlayer: Map<playerId, WebSocket>`
 *
 * Any future refactor that forgets to clear an entry on `socket.close`
 * would silently leak memory proportional to player churn. This test
 * connects N sockets, closes them all, and asserts both Maps shrink
 * back to 0. It's a sanity net, not a comprehensive socket lifecycle
 * test — the goal is just "don't regress into a leak".
 */
test("lobbyConnections empties after disconnect cycle", async () => {
  const service = new GameService(new InMemoryGameRoomStore(), () => 0);
  const svc = service as unknown as {
    lobbyConnections: Map<string, Set<unknown>>;
    matchmakingSocketByPlayer: Map<string, unknown>;
  };

  assert.equal(svc.lobbyConnections.size, 0, "starts empty");

  // Connect 50 distinct players on fresh sockets
  const pairs: Array<{ player: PlayerIdentity; socket: FakeSocket }> = [];
  for (let i = 0; i < 50; i++) {
    const player = createPlayer(`leak-probe-${i}`);
    const socket = new FakeSocket();
    await service.connectLobby(player, socket as unknown as WebSocket);
    pairs.push({ player, socket });
  }

  assert.equal(svc.lobbyConnections.size, 50, "50 connected");

  // Fire close on every socket
  for (const { socket } of pairs) {
    socket.triggerClose();
  }

  // Let any microtask-scheduled cleanup settle
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  assert.equal(svc.lobbyConnections.size, 0, "lobbyConnections leaked");
  await service.close();
});

test("lobbyConnections handles multiple sockets per player (account with multiple tabs)", async () => {
  const service = new GameService(new InMemoryGameRoomStore(), () => 0);
  const svc = service as unknown as {
    lobbyConnections: Map<string, Set<unknown>>;
  };

  const player = createPlayer("multi-tab-user");
  const socketA = new FakeSocket();
  const socketB = new FakeSocket();
  const socketC = new FakeSocket();

  await service.connectLobby(player, socketA as unknown as WebSocket);
  await service.connectLobby(player, socketB as unknown as WebSocket);
  await service.connectLobby(player, socketC as unknown as WebSocket);

  // All three sockets share the same playerId entry
  assert.equal(svc.lobbyConnections.size, 1, "one player");
  const sockets = svc.lobbyConnections.get(player.playerId);
  assert.ok(sockets);
  assert.equal(sockets.size, 3, "three sockets for one player");

  // Close one tab — entry should stay (other tabs still open)
  socketA.triggerClose();
  await new Promise((r) => setImmediate(r));
  assert.equal(svc.lobbyConnections.get(player.playerId)?.size, 2, "two sockets left");
  assert.equal(svc.lobbyConnections.size, 1, "entry still present");

  // Close the remaining two — entry should be removed entirely
  socketB.triggerClose();
  socketC.triggerClose();
  await new Promise((r) => setImmediate(r));

  assert.equal(svc.lobbyConnections.size, 0, "entry removed after last socket");
  await service.close();
});

test("matchmakingSocketByPlayer cleared when owning socket closes", async () => {
  const service = new GameService(new InMemoryGameRoomStore(), () => 0);
  const svc = service as unknown as {
    lobbyConnections: Map<string, Set<unknown>>;
    matchmakingSocketByPlayer: Map<string, unknown>;
  };

  const player = createPlayer("lonely-searcher");
  const socket = new FakeSocket();

  await service.connectLobby(player, socket as unknown as WebSocket);

  // Enter matchmaking without anyone to match with — goes into queue
  const state = await service.enterMatchmakingViaSocket(
    player,
    null,
    socket as unknown as WebSocket,
  );
  assert.equal(state.status, "searching");
  assert.equal(svc.matchmakingSocketByPlayer.size, 1, "entry added while searching");

  // Close the socket — cleanup should drop the entry
  socket.triggerClose();
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  assert.equal(svc.matchmakingSocketByPlayer.size, 0, "matchmaking entry leaked");
  assert.equal(svc.lobbyConnections.size, 0, "lobby entry leaked");

  await service.close();
});
