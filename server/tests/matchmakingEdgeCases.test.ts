import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import type { LobbyClientMessage, PlayerIdentity } from "../../shared/src";
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

// Minimal `ws.WebSocket`-shaped mock used for exercising the lobby-socket
// matchmaking flow. We only need the bits `GameService.connectLobby` and its
// message/close handlers touch: `on`, `send`, `readyState`, and the ability to
// synthesise inbound messages + a close event.
class MockSocket extends EventEmitter {
  readyState = 1; // WebSocket.OPEN
  sent: string[] = [];
  send(payload: string): void {
    this.sent.push(payload);
  }
  simulateMessage(message: LobbyClientMessage): void {
    this.emit("message", Buffer.from(JSON.stringify(message)));
  }
  simulateClose(): void {
    this.readyState = 3; // WebSocket.CLOSED
    this.emit("close");
  }
  received(): Array<Record<string, unknown>> {
    return this.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
  }
}

// Wait a microtask so that the message handler (which runs async work via
// `void this.handleLobbyMessage(...)`) has a chance to settle.
async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test("entering matchmaking twice returns searching status", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");

  const first = await service.enterMatchmaking(alice);
  assert.equal(first.status, "searching");

  const second = await service.enterMatchmaking(alice);
  assert.equal(second.status, "searching");
});

test("leave matchmaking removes player from queue", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");

  await service.enterMatchmaking(alice);
  await service.leaveMatchmaking(alice);

  const state = await service.getMatchmakingState(alice);
  assert.equal(state.status, "idle");
});

test("leave matchmaking clears matched state", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  await service.enterMatchmaking(alice);
  const matched = await service.enterMatchmaking(bob);
  assert.equal(matched.status, "matched");

  // Alice was matched - leave matchmaking should clear state
  await service.leaveMatchmaking(alice);
  const state = await service.getMatchmakingState(alice);
  assert.equal(state.status, "idle");
});

test("guest player with active game can still enter matchmaking", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const guest = createPlayer("guest-mm", { kind: "guest" });
  const host = createPlayer("host");

  // Create an active game for the guest
  const game = await service.createGame(guest);
  await service.joinGame(game.gameId, host);

  // Guest should be able to enter matchmaking even with an active game
  const result = await service.enterMatchmaking(guest);
  assert.equal(result.status, "searching");
});

test("matchmaking creates room with matchmaking type", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  await service.enterMatchmaking(alice);
  const result = await service.enterMatchmaking(bob);

  assert.equal(result.status, "matched");
  if (result.status === "matched") {
    assert.equal(result.snapshot.roomType, "matchmaking");
    assert.equal(result.snapshot.status, "active");
    assert.equal(result.snapshot.players.length, 2);
  }
});

test("matchmaking state for unqueued player is idle", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");

  const state = await service.getMatchmakingState(alice);
  assert.equal(state.status, "idle");
});

test("three players matchmaking pairs first two", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");
  const carol = createPlayer("carol");

  const first = await service.enterMatchmaking(alice);
  assert.equal(first.status, "searching");

  const second = await service.enterMatchmaking(bob);
  assert.equal(second.status, "matched");

  // Carol enters after Alice and Bob are matched
  const third = await service.enterMatchmaking(carol);
  assert.equal(third.status, "searching");
});

test("leave matchmaking when not in queue is a no-op", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");

  // Should not throw
  await service.leaveMatchmaking(alice);
  const state = await service.getMatchmakingState(alice);
  assert.equal(state.status, "idle");
});

// --- Time control matchmaking tests ---

const TC_30_0 = { initialMs: 1_800_000, incrementMs: 0 };
const TC_10_5 = { initialMs: 600_000, incrementMs: 5_000 };

test("two players with same time control get matched", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const first = await service.enterMatchmaking(alice, TC_30_0);
  assert.equal(first.status, "searching");

  const second = await service.enterMatchmaking(bob, TC_30_0);
  assert.equal(second.status, "matched");

  if (second.status === "matched") {
    assert.equal(second.snapshot.timeControl?.initialMs, TC_30_0.initialMs);
    assert.equal(second.snapshot.timeControl?.incrementMs, TC_30_0.incrementMs);
    assert.ok(second.snapshot.clock);
  }
});

test("two players with different time controls do NOT match", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const first = await service.enterMatchmaking(alice, TC_30_0);
  assert.equal(first.status, "searching");

  const second = await service.enterMatchmaking(bob, TC_10_5);
  assert.equal(second.status, "searching");
});

test("timed player does NOT match untimed player", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  await service.enterMatchmaking(alice, TC_30_0);
  const result = await service.enterMatchmaking(bob, null);
  assert.equal(result.status, "searching");
});

test("two untimed players match each other", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  await service.enterMatchmaking(alice, null);
  const result = await service.enterMatchmaking(bob, null);
  assert.equal(result.status, "matched");

  if (result.status === "matched") {
    assert.equal(result.snapshot.timeControl, null);
    assert.equal(result.snapshot.clock, null);
  }
});

test("three players: A(30+0), B(10+5), C(30+0) — A and C match, B stays", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");
  const carol = createPlayer("carol");

  const first = await service.enterMatchmaking(alice, TC_30_0);
  assert.equal(first.status, "searching");

  const second = await service.enterMatchmaking(bob, TC_10_5);
  assert.equal(second.status, "searching");

  // Carol enters with 30+0 — should match Alice, not Bob
  const third = await service.enterMatchmaking(carol, TC_30_0);
  assert.equal(third.status, "matched");

  // Bob is still searching
  const bobState = await service.getMatchmakingState(bob);
  assert.equal(bobState.status, "searching");

  // Alice was matched
  const aliceState = await service.getMatchmakingState(alice);
  assert.equal(aliceState.status, "matched");
});

test("matched timed game has correct clock state", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  await service.enterMatchmaking(alice, TC_30_0);
  const result = await service.enterMatchmaking(bob, TC_30_0);

  assert.equal(result.status, "matched");
  if (result.status === "matched") {
    const { clock } = result.snapshot;
    assert.ok(clock);
    assert.equal(clock!.white, TC_30_0.initialMs);
    assert.equal(clock!.black, TC_30_0.initialMs);
    assert.ok(clock!.lastMoveAt);
  }
});

// --- Lobby-socket matchmaking tests ---
//
// These cover the bug where closing the matchmaking tab left ghost queue
// entries that got paired with real players. Lifetime is now tied to the
// socket that issued `matchmaking:enter`: closing that socket clears the
// queue entry, regardless of whether the player has other lobby tabs open.

test("closing the matchmaking socket removes the queue entry", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");

  const socket = new MockSocket();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await service.connectLobby(alice, socket as any);

  socket.simulateMessage({ type: "matchmaking:enter", timeControl: null });
  await flushAsync();

  const searching = await service.getMatchmakingState(alice);
  assert.equal(searching.status, "searching");

  socket.simulateClose();
  await flushAsync();

  const idle = await service.getMatchmakingState(alice);
  assert.equal(idle.status, "idle");
});

test("a second matchmaking tab evicts the first", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");

  const socketA = new MockSocket();
  const socketB = new MockSocket();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await service.connectLobby(alice, socketA as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await service.connectLobby(alice, socketB as any);

  socketA.simulateMessage({ type: "matchmaking:enter", timeControl: null });
  await flushAsync();
  socketB.simulateMessage({ type: "matchmaking:enter", timeControl: null });
  await flushAsync();

  // Socket A should have received a `matchmaking:preempted` message before
  // socket B took over the session. (Distinct from `matchmaking:state {
  // idle }` so the client can tell "user cancelled" from "another tab took
  // over" and not auto-re-enter, which used to cause ping-pong oscillation.)
  const aEviction = socketA.received().find((m) => m.type === "matchmaking:preempted");
  assert.ok(aEviction, "socket A should have received a preempted eviction");
  // And it should NOT have received a plain idle state — that would
  // re-trigger the client's auto-re-enter effect.
  const aIdle = socketA
    .received()
    .find(
      (m) =>
        m.type === "matchmaking:state" &&
        (m.state as { status: string } | undefined)?.status === "idle",
    );
  assert.equal(aIdle, undefined, "socket A should not receive a plain idle state");

  // Socket B should own the session now; its latest state message should be searching.
  const bStates = socketB.received().filter((m) => m.type === "matchmaking:state");
  const bLatest = bStates[bStates.length - 1] as { state: { status: string } } | undefined;
  assert.equal(bLatest?.state.status, "searching");

  // Closing socket A must NOT clear the queue entry (B owns it now).
  socketA.simulateClose();
  await flushAsync();
  const stillSearching = await service.getMatchmakingState(alice);
  assert.equal(stillSearching.status, "searching");

  // Closing socket B clears the entry.
  socketB.simulateClose();
  await flushAsync();
  const idle = await service.getMatchmakingState(alice);
  assert.equal(idle.status, "idle");
});

test("immediate match via socket notifies both players with matching gameId", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const aliceSocket = new MockSocket();
  const bobSocket = new MockSocket();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await service.connectLobby(alice, aliceSocket as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await service.connectLobby(bob, bobSocket as any);

  aliceSocket.simulateMessage({ type: "matchmaking:enter", timeControl: null });
  await flushAsync();
  bobSocket.simulateMessage({ type: "matchmaking:enter", timeControl: null });
  await flushAsync();

  // Alice (waiting) gets pushed a `matchmaking:matched` because her queue
  // entry was resolved asynchronously.
  const aliceMatched = aliceSocket.received().find((m) => m.type === "matchmaking:matched") as
    | { snapshot: { gameId: string } }
    | undefined;
  assert.ok(aliceMatched, "alice should receive matchmaking:matched");

  // Bob (initiator) receives the result as a `matchmaking:state` reply with
  // status `matched` — the direct response to his `matchmaking:enter`.
  const bobMatchedState = bobSocket
    .received()
    .find(
      (m) =>
        m.type === "matchmaking:state" &&
        (m.state as { status: string } | undefined)?.status === "matched",
    ) as { state: { status: "matched"; snapshot: { gameId: string } } } | undefined;
  assert.ok(bobMatchedState, "bob should receive matchmaking:state { matched }");

  assert.equal(aliceMatched.snapshot.gameId, bobMatchedState.state.snapshot.gameId);
});

test("closing a non-matchmaking lobby socket does NOT touch the queue", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");

  const matchmakingTab = new MockSocket();
  const profileTab = new MockSocket();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await service.connectLobby(alice, matchmakingTab as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await service.connectLobby(alice, profileTab as any);

  matchmakingTab.simulateMessage({ type: "matchmaking:enter", timeControl: null });
  await flushAsync();

  // Close the *other* tab (e.g. user closes their profile tab). Queue entry
  // must survive because the matchmaking socket is still open.
  profileTab.simulateClose();
  await flushAsync();

  const state = await service.getMatchmakingState(alice);
  assert.equal(state.status, "searching");
});

test("explicit matchmaking:leave clears the entry without closing the socket", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");

  const socket = new MockSocket();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await service.connectLobby(alice, socket as any);

  socket.simulateMessage({ type: "matchmaking:enter", timeControl: null });
  await flushAsync();
  assert.equal((await service.getMatchmakingState(alice)).status, "searching");

  socket.simulateMessage({ type: "matchmaking:leave" });
  await flushAsync();
  assert.equal((await service.getMatchmakingState(alice)).status, "idle");

  // The socket stays open, so closing it afterwards must not double-fire cleanup.
  socket.simulateClose();
  await flushAsync();
});

// ---------------------------------------------------------------------------
// matchmaking:resumable — wake a pre-empted tab when the active owner cancels
// ---------------------------------------------------------------------------

test("pre-empted socket gets matchmaking:resumable when active tab cancels", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");

  const socketA = new MockSocket();
  const socketB = new MockSocket();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await service.connectLobby(alice, socketA as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await service.connectLobby(alice, socketB as any);

  socketA.simulateMessage({ type: "matchmaking:enter", timeControl: null });
  await flushAsync();
  socketB.simulateMessage({ type: "matchmaking:enter", timeControl: null });
  await flushAsync();

  // Socket A is pre-empted; clear its received log so we can assert that
  // the `resumable` push happens strictly after the cancel below.
  socketA.sent = [];

  socketB.simulateMessage({ type: "matchmaking:leave" });
  await flushAsync();

  const resumable = socketA.received().find((m) => m.type === "matchmaking:resumable");
  assert.ok(
    resumable,
    "pre-empted socket A should be woken with matchmaking:resumable after B cancels",
  );
  // And the queue should be empty now that B left and A hasn't re-entered yet.
  assert.equal((await service.getMatchmakingState(alice)).status, "idle");
});

test("pre-empted socket gets matchmaking:resumable when active tab disconnects", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");

  const socketA = new MockSocket();
  const socketB = new MockSocket();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await service.connectLobby(alice, socketA as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await service.connectLobby(alice, socketB as any);

  socketA.simulateMessage({ type: "matchmaking:enter", timeControl: null });
  await flushAsync();
  socketB.simulateMessage({ type: "matchmaking:enter", timeControl: null });
  await flushAsync();

  socketA.sent = [];

  socketB.simulateClose();
  await flushAsync();

  const resumable = socketA.received().find((m) => m.type === "matchmaking:resumable");
  assert.ok(
    resumable,
    "pre-empted socket A should be woken with matchmaking:resumable after B closes",
  );
});

test("pre-empted socket is NOT woken when active tab matches", async () => {
  const store = new InMemoryGameRoomStore();
  const service = new GameService(store, () => 0);
  const alice = createPlayer("alice");
  const bob = createPlayer("bob");

  const aliceA = new MockSocket();
  const aliceB = new MockSocket();
  const bobSocket = new MockSocket();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await service.connectLobby(alice, aliceA as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await service.connectLobby(alice, aliceB as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await service.connectLobby(bob, bobSocket as any);

  aliceA.simulateMessage({ type: "matchmaking:enter", timeControl: null });
  await flushAsync();
  aliceB.simulateMessage({ type: "matchmaking:enter", timeControl: null });
  await flushAsync();

  aliceA.sent = [];

  // Bob joins the queue and gets matched with aliceB (the active owner).
  bobSocket.simulateMessage({ type: "matchmaking:enter", timeControl: null });
  await flushAsync();

  const aliceBMatched = aliceB.received().find((m) => m.type === "matchmaking:matched");
  assert.ok(aliceBMatched, "aliceB should have matched with bob");

  const resumable = aliceA.received().find((m) => m.type === "matchmaking:resumable");
  assert.equal(
    resumable,
    undefined,
    "aliceA should NOT be woken when the active tab transitions to matched",
  );
});
