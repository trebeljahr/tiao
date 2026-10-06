import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import type WebSocket from "ws";
import type { PlayerIdentity, TimeControl } from "../../shared/src";
import { GameService } from "../game/gameService";
import { InMemoryGameRoomStore } from "../game/gameStore";

class Socket extends EventEmitter {
  readyState = 1;
  sent: Array<Record<string, unknown>> = [];
  send(raw: string): void {
    this.sent.push(JSON.parse(raw));
  }
  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit("close");
  }
  get ws(): WebSocket {
    return this as unknown as WebSocket;
  }
}

const player = (playerId: string): PlayerIdentity => ({
  playerId,
  displayName: playerId,
  kind: "account",
});
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const THIRTY: TimeControl = { initialMs: 1_800_000, incrementMs: 0 };

/** Pairs alice (white, absent) with bob and expires the first-move deadline. */
async function abortedPairing() {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = player("alice"),
    bob = player("bob");
  const aliceLobby = new Socket(),
    bobLobby = new Socket();
  await service.connectLobby(alice, aliceLobby.ws);
  await service.connectLobby(bob, bobLobby.ws);
  await service.enterMatchmakingViaSocket(alice, THIRTY, aliceLobby.ws, randomUUID());
  const matched = await service.enterMatchmakingViaSocket(bob, THIRTY, bobLobby.ws, randomUUID());
  if (matched.status !== "matched") throw new Error("Expected a match");
  assert.equal(matched.snapshot.seats.white?.player.playerId, "alice");
  const room = await store.getRoom(matched.snapshot.gameId);
  assert.ok(room);
  room.firstMoveDeadline = new Date(Date.now() - 1000);
  await store.saveRoom(room);
  const expire = () =>
    (
      service as unknown as { handleFirstMoveExpired(id: string): Promise<void> }
    ).handleFirstMoveExpired(matched.snapshot.gameId);
  return { service, bob, aliceLobby, bobLobby, expire };
}

async function search(service: GameService, playerId: string) {
  const socket = new Socket();
  const identity = player(playerId);
  await service.connectLobby(identity, socket.ws);
  const state = await service.enterMatchmakingViaSocket(identity, THIRTY, socket.ws, randomUUID());
  return { socket, state };
}

test("first-move abort does not requeue an opponent whose lobby is closed", async () => {
  const { service, aliceLobby, bobLobby, expire } = await abortedPairing();
  const carol = { socket: new Socket() };
  try {
    // Both browsers went away before the deadline (closed tab or context).
    aliceLobby.close();
    bobLobby.close();
    await tick();
    await expire();
    const next = await search(service, "carol");
    carol.socket = next.socket;
    assert.equal(next.state.status, "searching", "carol must not be paired with absent bob");
  } finally {
    carol.socket.close();
    await service.close();
  }
});

test("a requeued opponent leaves the queue when their lobby closes", async () => {
  const { service, bob, aliceLobby, bobLobby, expire } = await abortedPairing();
  const carol = { socket: new Socket() };
  try {
    aliceLobby.close();
    await tick();
    await expire();
    assert.equal((await service.getMatchmakingState(bob)).status, "searching");
    bobLobby.close();
    await tick();
    await tick();
    const next = await search(service, "carol");
    carol.socket = next.socket;
    assert.equal(next.state.status, "searching", "carol must not be paired with absent bob");
  } finally {
    carol.socket.close();
    await service.close();
  }
});

test("a connected opponent is requeued and paired after a first-move abort", async () => {
  const { service, aliceLobby, bobLobby, expire } = await abortedPairing();
  const carol = { socket: new Socket() };
  try {
    aliceLobby.close();
    await tick();
    await expire();
    const next = await search(service, "carol");
    carol.socket = next.socket;
    assert.equal(next.state.status, "matched");
    if (next.state.status !== "matched") return;
    const seated = [next.state.snapshot.seats.white, next.state.snapshot.seats.black].map(
      (seat) => seat?.player.playerId,
    );
    assert.deepEqual(seated.sort(), ["bob", "carol"]);
  } finally {
    bobLobby.close();
    carol.socket.close();
    await service.close();
  }
});
