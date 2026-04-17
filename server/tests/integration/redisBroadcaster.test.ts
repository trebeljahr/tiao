import assert from "node:assert/strict";
import { describe, test, before, beforeEach, afterEach, after } from "node:test";
import Redis from "ioredis";
import { RedisBroadcaster } from "../../game/broadcaster";
import type { BroadcastChannel } from "../../game/broadcaster";

// RedisBroadcaster uses Redis Pub/Sub, whose channel names are GLOBAL
// across all databases on a Redis instance (Pub/Sub is not db-namespaced).
// So db isolation alone does NOT isolate us from the dev server or from
// other concurrent test files. The real isolation comes from:
//   1. Randomized room/player IDs per-test run (testRunId).
//   2. No cross-instance publishLobbyAll test (would leak into the dev
//      server's global lobby channel).
// We still use a dedicated db number for any non-Pub/Sub keys and so that
// `flushdb` in other Redis test files never touches anything this file
// writes. The dev server uses db 0.
const TEST_DB = 13;

type Received = {
  channel: BroadcastChannel;
  target: string | null;
  message: string;
};

function createClient(): Redis {
  const client = new Redis({
    host: "127.0.0.1",
    port: 6379,
    db: TEST_DB,
    maxRetriesPerRequest: 3,
    connectTimeout: 2000,
  });
  // Swallow post-teardown socket errors — when the test ends we quit the
  // publisher explicitly; any late "Connection is closed" events on the
  // duplicated subscriber should not fail the test. ioredis emits 'error'
  // on disconnect which Node treats as fatal without a handler.
  client.on("error", () => {
    /* ignore */
  });
  return client;
}

/** Wait until `pred` returns true, polling every 10ms, up to `timeoutMs`. */
async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("RedisBroadcaster", () => {
  let redisAvailable = false;
  let pingClient: Redis | null = null;
  // Track all resources created in a test so afterEach can tear down.
  let publishers: Redis[] = [];
  let broadcasters: RedisBroadcaster[] = [];
  let testRunId = "";

  before(async () => {
    let client: Redis | null = null;
    try {
      client = createClient();
      await client.ping();
      pingClient = client;
      redisAvailable = true;
    } catch {
      redisAvailable = false;
      // Disconnect the orphan client so its reconnection loop doesn't
      // keep the event loop alive and hang the test process on exit.
      client?.disconnect();
    }
  });

  beforeEach(() => {
    publishers = [];
    broadcasters = [];
    testRunId = `test-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    // Individual tests handle the skip when redisAvailable is false.
  });

  afterEach(async () => {
    // Close broadcasters (they own their subscriber connection)
    for (const b of broadcasters) {
      await b.close().catch(() => {});
    }
    // Quit publishers we created explicitly
    for (const p of publishers) {
      await p.quit().catch(() => {});
    }
    publishers = [];
    broadcasters = [];
  });

  after(async () => {
    if (pingClient) {
      await pingClient.quit().catch(() => {});
      pingClient = null;
    }
  });

  async function makeBroadcaster(): Promise<{
    broadcaster: RedisBroadcaster;
    received: Received[];
  }> {
    const publisher = createClient();
    // Wait for the publisher to reach a "ready" state so the subsequent
    // duplicate()-based subscriber has a live connection template.
    await publisher.ping();
    publishers.push(publisher);
    const broadcaster = new RedisBroadcaster(publisher);
    broadcasters.push(broadcaster);
    const received: Received[] = [];
    broadcaster.onMessage((channel, target, message) => {
      received.push({ channel, target, message });
    });
    // Give the subscriber a tick to attach and for SUBSCRIBE to ack
    await new Promise((r) => setTimeout(r, 100));
    return { broadcaster, received };
  }

  test("publishLobby delivers locally (synchronous handler call)", async (t) => {
    if (!redisAvailable) return t.skip();
    const { broadcaster, received } = await makeBroadcaster();
    broadcaster.publishLobby(`p-${testRunId}`, '{"type":"game-update"}');
    // Delivered synchronously inside publishLobby
    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0]!.channel, "lobby");
    assert.strictEqual(received[0]!.target, `p-${testRunId}`);
    assert.strictEqual(received[0]!.message, '{"type":"game-update"}');
  });

  test("publishRoom delivers locally", async (t) => {
    if (!redisAvailable) return t.skip();
    const { broadcaster, received } = await makeBroadcaster();
    broadcaster.publishRoom(`ROOM-${testRunId}`, '{"type":"snapshot"}');
    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0]!.channel, "room");
    assert.strictEqual(received[0]!.target, `ROOM-${testRunId}`);
  });

  test("publishLobbyAll delivers locally with null target", async (t) => {
    if (!redisAvailable) return t.skip();
    const { broadcaster, received } = await makeBroadcaster();
    broadcaster.publishLobbyAll('{"type":"lobby-update"}');
    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0]!.channel, "lobby-all");
    assert.strictEqual(received[0]!.target, null);
  });

  test("publishRoom reaches a subscribed peer instance across Redis Pub/Sub", async (t) => {
    if (!redisAvailable) return t.skip();
    const roomId = `ROOM-${testRunId}`;
    const a = await makeBroadcaster();
    const b = await makeBroadcaster();
    b.broadcaster.subscribeRoom(roomId);
    // Give the SUBSCRIBE command time to land
    await new Promise((r) => setTimeout(r, 100));

    a.broadcaster.publishRoom(roomId, '{"type":"snapshot"}');

    // Wait for B to receive the message over Redis Pub/Sub
    await waitFor(() => b.received.some((r) => r.channel === "room" && r.target === roomId));

    // A also received it locally (synchronous path)
    assert.strictEqual(a.received.length, 1);
    assert.strictEqual(a.received[0]!.channel, "room");

    // B received it exactly once (via Redis)
    const bRoomMsgs = b.received.filter((r) => r.channel === "room");
    assert.strictEqual(bRoomMsgs.length, 1);
    assert.strictEqual(bRoomMsgs[0]!.target, roomId);
    assert.strictEqual(bRoomMsgs[0]!.message, '{"type":"snapshot"}');
  });

  test("publishLobby reaches a subscribed peer instance across Redis Pub/Sub", async (t) => {
    if (!redisAvailable) return t.skip();
    const playerId = `p-${testRunId}`;
    const a = await makeBroadcaster();
    const b = await makeBroadcaster();
    b.broadcaster.subscribeLobby(playerId);
    await new Promise((r) => setTimeout(r, 100));

    a.broadcaster.publishLobby(playerId, '{"type":"game-update"}');

    await waitFor(() => b.received.some((r) => r.channel === "lobby" && r.target === playerId));
    const bLobbyMsgs = b.received.filter((r) => r.channel === "lobby");
    assert.strictEqual(bLobbyMsgs.length, 1);
  });

  test("anti-echo: publisher's own messages don't loop back via Redis", async (t) => {
    if (!redisAvailable) return t.skip();
    const roomId = `ROOM-${testRunId}`;
    const a = await makeBroadcaster();
    // A subscribes to its own room so Redis would try to deliver its
    // publish back — but the anti-echo iid check should drop it.
    a.broadcaster.subscribeRoom(roomId);
    await new Promise((r) => setTimeout(r, 100));

    a.broadcaster.publishRoom(roomId, "hello");

    // Wait long enough for any looped-back message to arrive
    await new Promise((r) => setTimeout(r, 200));

    // Expect exactly ONE delivery: the synchronous local one, not the echo
    const roomMsgs = a.received.filter((r) => r.channel === "room");
    assert.strictEqual(
      roomMsgs.length,
      1,
      `anti-echo failed: got ${roomMsgs.length} room messages`,
    );
  });

  test("anti-echo: two broadcasters on same Redis — publisher not echoed, peer receives", async (t) => {
    if (!redisAvailable) return t.skip();
    const roomId = `ROOM-${testRunId}`;
    const a = await makeBroadcaster();
    const b = await makeBroadcaster();
    // Both subscribe to the same room
    a.broadcaster.subscribeRoom(roomId);
    b.broadcaster.subscribeRoom(roomId);
    await new Promise((r) => setTimeout(r, 100));

    a.broadcaster.publishRoom(roomId, "from-A");

    // Wait for B to receive
    await waitFor(() => b.received.some((r) => r.channel === "room"));
    // Give the network a little extra time to ensure no echo is still in flight
    await new Promise((r) => setTimeout(r, 100));

    // A saw it exactly once (local delivery), NOT twice (would mean echo leaked)
    const aRoomMsgs = a.received.filter((r) => r.channel === "room");
    assert.strictEqual(aRoomMsgs.length, 1, `anti-echo failed on A: ${aRoomMsgs.length} messages`);
    assert.strictEqual(aRoomMsgs[0]!.message, "from-A");

    // B saw it once (from Redis)
    const bRoomMsgs = b.received.filter((r) => r.channel === "room");
    assert.strictEqual(bRoomMsgs.length, 1);
    assert.strictEqual(bRoomMsgs[0]!.message, "from-A");
  });

  test("unsubscribeRoom stops receiving messages for that room", async (t) => {
    if (!redisAvailable) return t.skip();
    const roomId = `ROOM-${testRunId}`;
    const a = await makeBroadcaster();
    const b = await makeBroadcaster();
    b.broadcaster.subscribeRoom(roomId);
    await new Promise((r) => setTimeout(r, 100));

    a.broadcaster.publishRoom(roomId, "first");
    await waitFor(() => b.received.some((r) => r.channel === "room"));
    const beforeCount = b.received.filter((r) => r.channel === "room").length;

    b.broadcaster.unsubscribeRoom(roomId);
    await new Promise((r) => setTimeout(r, 100));

    a.broadcaster.publishRoom(roomId, "second");
    // Allow time for any stray delivery
    await new Promise((r) => setTimeout(r, 200));

    const afterCount = b.received.filter((r) => r.channel === "room").length;
    assert.strictEqual(
      afterCount,
      beforeCount,
      "expected no additional room messages after unsubscribe",
    );
  });

  test("close() tears down subscriber and clears handler", async (t) => {
    if (!redisAvailable) return t.skip();
    // Build a broadcaster by hand so we can close it without the afterEach
    // hook double-closing it.
    const publisher = createClient();
    await publisher.ping();
    publishers.push(publisher);
    const broadcaster = new RedisBroadcaster(publisher);
    const received: Received[] = [];
    broadcaster.onMessage((channel, target, message) => {
      received.push({ channel, target, message });
    });
    // Give the subscriber a tick to attach
    await new Promise((r) => setTimeout(r, 50));

    await broadcaster.close();

    // After close, a local publish should not call the handler (it was cleared)
    broadcaster.publishRoom(`anyroom-${testRunId}`, "ignored");
    assert.strictEqual(received.length, 0, "handler should be cleared after close");
    // Don't push to broadcasters[] — already closed.
  });

  // Note: we intentionally do NOT test cross-instance publishLobbyAll here.
  // LOBBY_ALL_CHANNEL is a single global Pub/Sub channel (not scoped by Redis db),
  // and the running dev server subscribes to it. A cross-instance test would
  // leak test messages into the dev server's lobby and forward them to real
  // connected clients. The local delivery path for publishLobbyAll is covered
  // above, and the anti-echo / cross-instance logic is covered by the room
  // and lobby channel tests (which use randomized IDs so no dev subscribers
  // match).
});
