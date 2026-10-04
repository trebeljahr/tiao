import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import type WebSocket from "ws";
import type { PlayerIdentity } from "../../shared/src";
import { InMemoryBroadcaster } from "../game/broadcaster";
import { GameService } from "../game/gameService";
import { InMemoryGameRoomStore } from "../game/gameStore";
import { InMemoryLockProvider } from "../game/lockProvider";
import { InMemoryMatchmakingStore } from "../game/matchmakingStore";
import { InMemoryRoomPresence } from "../game/presence";

class Socket extends EventEmitter {
  readyState = 1;
  sent: Array<Record<string, unknown>> = [];
  send(raw: string): void {
    this.sent.push(JSON.parse(raw));
  }
  close(): void {
    this.readyState = 3;
    this.emit("close");
  }
  get ws(): WebSocket {
    return this as unknown as WebSocket;
  }
}
class Bus extends InMemoryBroadcaster {
  constructor(private readonly peers: Bus[]) {
    super();
    peers.push(this);
  }
  override publishLobby(playerId: string, message: string): void {
    for (const peer of this.peers) peer.deliver(playerId, message);
  }
  private deliver(playerId: string, message: string): void {
    super.publishLobby(playerId, message);
  }
}
const player = (playerId: string): PlayerIdentity => ({
  playerId,
  displayName: playerId,
  kind: "guest",
});
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function replicas(matchmaking = new InMemoryMatchmakingStore()) {
  const store = new InMemoryGameRoomStore();
  const locks = new InMemoryLockProvider();
  const presence = new InMemoryRoomPresence();
  const peers: Bus[] = [];
  const services = [0, 1].map(
    () =>
      new GameService(
        store,
        () => 0,
        1000,
        matchmaking,
        locks,
        new Bus(peers),
        undefined,
        undefined,
        presence,
      ),
  );
  return {
    store,
    matchmaking,
    services,
    close: async () => {
      for (const service of services) await service.close();
    },
  };
}

test("retiring socket cannot cancel a successor replica's search or shared presence", async () => {
  const fixture = replicas();
  const [a, b] = fixture.services;
  const alice = player("alice");
  const old = new Socket(),
    successor = new Socket();
  try {
    await a.connectLobby(alice, old.ws);
    await b.connectLobby(alice, successor.ws);
    await a.enterMatchmakingViaSocket(alice, null, old.ws, randomUUID());
    await b.enterMatchmakingViaSocket(alice, null, successor.ws, randomUUID());
    assert.ok(old.sent.some((message) => message.type === "matchmaking:preempted"));
    old.close();
    await tick();
    await tick();
    assert.equal((await a.getMatchmakingState(alice)).status, "searching");
    assert.equal(await a.isPlayerConnectedToLobby(alice.playerId), true);
    await a.leaveMatchmakingViaSocket(alice, old.ws);
    assert.equal((await b.getMatchmakingState(alice)).status, "searching");
    await b.leaveMatchmakingViaSocket(alice, successor.ws);
    assert.equal((await b.getMatchmakingState(alice)).status, "idle");
  } finally {
    old.close();
    successor.close();
    await fixture.close();
  }
});

test("lost matched reply recovers the same Mongo-shaped room after receipt loss", async () => {
  class FailingPointer extends InMemoryMatchmakingStore {
    fail = true;
    override async setMatch(playerId: string, roomId: string): Promise<void> {
      if (this.fail) {
        this.fail = false;
        throw new Error("synthetic reply loss after room commit");
      }
      await super.setMatch(playerId, roomId);
    }
  }
  const fixture = replicas(new FailingPointer());
  const [a, b] = fixture.services;
  const alice = player("alice"),
    bob = player("bob");
  const first = new Socket(),
    waiting = new Socket(),
    successor = new Socket();
  const attempt = randomUUID(),
    opponentAttempt = randomUUID();
  try {
    await a.connectLobby(alice, first.ws);
    await b.connectLobby(bob, waiting.ws);
    await b.enterMatchmakingViaSocket(bob, null, waiting.ws, opponentAttempt);
    await assert.rejects(a.enterMatchmakingViaSocket(alice, null, first.ws, attempt), /synthetic/);
    first.close();
    await tick();
    await b.connectLobby(alice, successor.ws);
    const recovered = await b.enterMatchmakingViaSocket(alice, null, successor.ws, attempt);
    assert.equal(recovered.status, "matched");
    if (recovered.status !== "matched") throw new Error("Expected matched room");
    const opponentRecovery = await b.enterMatchmakingViaSocket(
      bob,
      null,
      waiting.ws,
      opponentAttempt,
    );
    assert.equal(opponentRecovery.status, "matched");
    assert.equal((await fixture.store.listRoomsForPlayer(alice.playerId)).length, 1);
    assert.equal(
      (await fixture.store.findRoomByMatchmakingAttempt(`${bob.playerId}:${opponentAttempt}`))?.id,
      recovered.snapshot.gameId,
    );
    await assert.rejects(
      b.enterMatchmakingViaSocket(
        alice,
        { initialMs: 1000, incrementMs: 0 },
        successor.ws,
        attempt,
      ),
      /cannot change/,
    );
  } finally {
    first.close();
    waiting.close();
    successor.close();
    await fixture.close();
  }
});

test("expired remote presence is pruned before another player can match it", async () => {
  const fixture = replicas();
  const [a, b] = fixture.services;
  const ghost = player("ghost"),
    alice = player("alice");
  const socket = new Socket();
  try {
    await fixture.matchmaking.addToQueue({
      player: ghost,
      queuedAt: Date.now(),
      timeControl: null,
      rating: 1500,
      ownerId: "expired-connection",
      attemptId: randomUUID(),
    });
    await b.connectLobby(alice, socket.ws);
    assert.equal(
      (await b.enterMatchmakingViaSocket(alice, null, socket.ws, randomUUID())).status,
      "searching",
    );
    assert.equal(await fixture.matchmaking.findEntry(ghost.playerId), null);
    assert.equal((await fixture.store.listRoomsForPlayer(alice.playerId)).length, 0);
    assert.equal(await a.isPlayerConnectedToLobby(alice.playerId), true);
  } finally {
    socket.close();
    await fixture.close();
  }
});

test("a surviving waiting socket receives a committed match after the publisher dies", async () => {
  const fixture = replicas();
  const [a, b] = fixture.services;
  const alice = player("alice"),
    bob = player("bob");
  const waiting = new Socket(),
    incoming = new Socket(),
    game = new Socket();
  try {
    await b.connectLobby(alice, waiting.ws);
    await a.connectLobby(bob, incoming.ws);
    await b.enterMatchmakingViaSocket(alice, null, waiting.ws, randomUUID());
    // Drop every outbound notification from the committing replica, as if it
    // exited between Mongo commit and Pub/Sub publish. The waiting socket stays open.
    a.broadcastLobby = () => undefined;
    const matched = await a.enterMatchmakingViaSocket(bob, null, incoming.ws, randomUUID());
    assert.equal(matched.status, "matched");
    assert.equal(
      waiting.sent.some((row) => row.type === "matchmaking:matched"),
      false,
    );
    await (b as unknown as { sweepMatchmakingQueue(): Promise<void> }).sweepMatchmakingQueue();
    assert.equal(waiting.sent.filter((row) => row.type === "matchmaking:matched").length, 1);
    if (matched.status !== "matched") throw new Error("Expected match");
    await b.connect(matched.snapshot.gameId, alice, game.ws);
    assert.equal(
      (await fixture.store.getRoom(matched.snapshot.gameId))?.matchmakingPendingPlayerIds?.includes(
        alice.playerId,
      ),
      false,
    );
    await b.disconnect(game.ws);
  } finally {
    waiting.close();
    incoming.close();
    game.close();
    await fixture.close();
  }
});

test("failed room creation keeps the waiting opponent queued for a later retry", async () => {
  const fixture = replicas();
  const [a, b] = fixture.services;
  const alice = player("alice"),
    bob = player("bob");
  const waiting = new Socket(),
    incoming = new Socket();
  const create = fixture.store.createRoom.bind(fixture.store);
  let fail = true;
  fixture.store.createRoom = async (input) => {
    if (fail) {
      fail = false;
      throw new Error("synthetic database loss before commit");
    }
    return create(input);
  };
  try {
    await b.connectLobby(alice, waiting.ws);
    await a.connectLobby(bob, incoming.ws);
    await b.enterMatchmakingViaSocket(alice, null, waiting.ws, randomUUID());
    const attemptId = randomUUID();
    await assert.rejects(
      a.enterMatchmakingViaSocket(bob, null, incoming.ws, attemptId),
      /before commit/,
    );
    assert.ok(await fixture.matchmaking.findEntry(alice.playerId));
    const retried = await a.enterMatchmakingViaSocket(bob, null, incoming.ws, attemptId);
    assert.equal(retried.status, "matched");
    assert.equal((await fixture.store.listRoomsForPlayer(alice.playerId)).length, 1);
  } finally {
    waiting.close();
    incoming.close();
    await fixture.close();
  }
});

test("a delayed sweep notification cannot forget a newer local search owner", async () => {
  const fixture = replicas();
  const [service] = fixture.services;
  const alice = player("alice"),
    bob = player("bob");
  const old = new Socket(),
    newer = new Socket(),
    takeover = new Socket();
  const internal = service as unknown as {
    toSnapshot: (room: unknown) => Promise<unknown>;
    sweepMatchmakingQueue(): Promise<void>;
  };
  const snapshot = internal.toSnapshot.bind(service);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reached!: () => void;
  const atNotification = new Promise<void>((resolve) => {
    reached = resolve;
  });
  try {
    await service.connectLobby(alice, old.ws);
    await service.connectLobby(alice, newer.ws);
    await service.connectLobby(alice, takeover.ws);
    await service.enterMatchmakingViaSocket(alice, null, old.ws, randomUUID());
    await fixture.matchmaking.addToQueue({
      player: bob,
      queuedAt: Date.now(),
      rating: 1500,
      timeControl: null,
      attemptId: `bob:${randomUUID()}`,
    });
    internal.toSnapshot = async (room) => {
      reached();
      await held;
      return snapshot(room);
    };
    const sweeping = internal.sweepMatchmakingQueue();
    await atNotification;
    assert.equal(
      (await service.enterMatchmakingViaSocket(alice, null, newer.ws, randomUUID())).status,
      "searching",
    );
    release();
    await sweeping;
    await service.enterMatchmakingViaSocket(alice, null, takeover.ws, randomUUID());
    assert.ok(newer.sent.some((message) => message.type === "matchmaking:preempted"));
  } finally {
    release();
    old.close();
    newer.close();
    takeover.close();
    await fixture.close();
  }
});

test("service shutdown waits for accepted queue cleanup to release its authority", async () => {
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  class SlowQueue extends InMemoryMatchmakingStore {
    override async removeFromQueue(playerId: string, ownerId?: string): Promise<boolean> {
      entered();
      await gate;
      return super.removeFromQueue(playerId, ownerId);
    }
  }
  const service = new GameService(new InMemoryGameRoomStore(), Math.random, 1000, new SlowQueue());
  const cleanup = service.leaveMatchmaking(player("alice"));
  await started;
  let closed = false;
  const closing = service.close().then(() => {
    closed = true;
  });
  await tick();
  assert.equal(closed, false);
  release();
  await cleanup;
  await closing;
  assert.equal(closed, true);
});

test("a superseded search cannot reclaim the queue after its preemption notice is lost", async () => {
  class SilentBus extends InMemoryBroadcaster {
    override publishLobby(): void {}
  }
  const store = new InMemoryGameRoomStore();
  const matchmaking = new InMemoryMatchmakingStore();
  const locks = new InMemoryLockProvider();
  const presence = new InMemoryRoomPresence();
  // Two replicas whose Pub/Sub drops every lobby control message.
  const [a, b] = [0, 1].map(
    () =>
      new GameService(
        store,
        () => 0,
        1000,
        matchmaking,
        locks,
        new SilentBus(),
        undefined,
        undefined,
        presence,
      ),
  );
  const alice = player("alice");
  const oldTab = new Socket(),
    newTab = new Socket(),
    oldTabReconnect = new Socket();
  const oldSearch = randomUUID(),
    newSearch = randomUUID();
  try {
    await a.connectLobby(alice, oldTab.ws);
    await b.connectLobby(alice, newTab.ws);
    assert.equal(
      (await a.enterMatchmakingViaSocket(alice, null, oldTab.ws, oldSearch)).status,
      "searching",
    );
    assert.equal(
      (await b.enterMatchmakingViaSocket(alice, null, newTab.ws, newSearch)).status,
      "searching",
    );
    assert.equal(
      oldTab.sent.some((message) => message.type === "matchmaking:preempted"),
      false,
      "fixture must lose the cross-replica preemption notice",
    );
    // The old tab never learned it was replaced. A rolling restart reconnects it.
    oldTab.close();
    await tick();
    await a.connectLobby(alice, oldTabReconnect.ws);
    await assert.rejects(
      a.enterMatchmakingViaSocket(alice, null, oldTabReconnect.ws, oldSearch),
      (error: { code?: string }) => error.code === "SEARCH_SUPERSEDED",
    );
    const queued = await matchmaking.findEntry(alice.playerId);
    assert.equal(queued?.attemptId, `${alice.playerId}:${newSearch}`);
    // The newer search still resumes normally after its own reconnect.
    assert.equal(
      (await b.enterMatchmakingViaSocket(alice, null, newTab.ws, newSearch)).status,
      "searching",
    );
  } finally {
    oldTab.close();
    newTab.close();
    oldTabReconnect.close();
    await a.close();
    await b.close();
  }
});

test("a search replaced while its tab was offline is also superseded", async () => {
  const fixture = replicas();
  const [a, b] = fixture.services;
  const alice = player("alice");
  const oldTab = new Socket(),
    newTab = new Socket(),
    oldTabReconnect = new Socket();
  const oldSearch = randomUUID();
  try {
    await a.connectLobby(alice, oldTab.ws);
    await a.enterMatchmakingViaSocket(alice, null, oldTab.ws, oldSearch);
    // Old tab drops off; its queue row is cancelled, but its search id survives.
    oldTab.close();
    await tick();
    await tick();
    assert.equal(await fixture.matchmaking.findEntry(alice.playerId), null);
    await b.connectLobby(alice, newTab.ws);
    await b.enterMatchmakingViaSocket(alice, null, newTab.ws, randomUUID());
    await a.connectLobby(alice, oldTabReconnect.ws);
    await assert.rejects(
      a.enterMatchmakingViaSocket(alice, null, oldTabReconnect.ws, oldSearch),
      (error: { code?: string }) => error.code === "SEARCH_SUPERSEDED",
    );
  } finally {
    oldTab.close();
    newTab.close();
    oldTabReconnect.close();
    await fixture.close();
  }
});

test("same search id resumes after its socket was lost and refuses a changed time control", async () => {
  const fixture = replicas();
  const [a, b] = fixture.services;
  const alice = player("alice");
  const first = new Socket(),
    second = new Socket();
  const search = randomUUID();
  try {
    await a.connectLobby(alice, first.ws);
    await a.enterMatchmakingViaSocket(alice, null, first.ws, search);
    first.close();
    await tick();
    await tick();
    await b.connectLobby(alice, second.ws);
    await assert.rejects(
      b.enterMatchmakingViaSocket(alice, { initialMs: 60_000, incrementMs: 0 }, second.ws, search),
      (error: { code?: string }) => error.code === "SEARCH_ID_REUSED",
    );
    assert.equal(
      (await b.enterMatchmakingViaSocket(alice, null, second.ws, search)).status,
      "searching",
    );
  } finally {
    first.close();
    second.close();
    await fixture.close();
  }
});

test("a delayed ownership notice cannot preempt a newer owner", async () => {
  const fixture = replicas();
  const [a, b] = fixture.services;
  const alice = player("alice");
  const first = new Socket(),
    second = new Socket();
  // Capture the notice from the first claim and redeliver it late to replica B.
  const notices: string[] = [];
  const bus = (b as unknown as { broadcaster: { deliver(id: string, m: string): void } })
    .broadcaster;
  const originalPublish = (a as unknown as { broadcaster: Bus }).broadcaster.publishLobby.bind(
    (a as unknown as { broadcaster: Bus }).broadcaster,
  );
  (a as unknown as { broadcaster: Bus }).broadcaster.publishLobby = (id, message) => {
    if (JSON.parse(message).type === "matchmaking:owner") notices.push(message);
    originalPublish(id, message);
  };
  try {
    await a.connectLobby(alice, first.ws);
    await b.connectLobby(alice, second.ws);
    await a.enterMatchmakingViaSocket(alice, null, first.ws, randomUUID());
    await b.enterMatchmakingViaSocket(alice, null, second.ws, randomUUID());
    assert.ok(first.sent.some((m) => m.type === "matchmaking:preempted"));
    assert.equal(notices.length, 1);
    bus.deliver(alice.playerId, notices[0]);
    assert.equal(
      second.sent.some((m) => m.type === "matchmaking:preempted"),
      false,
      "stale first-claim notice must not preempt the newer owner",
    );
    assert.equal((await b.getMatchmakingState(alice)).status, "searching");
  } finally {
    first.close();
    second.close();
    await fixture.close();
  }
});
