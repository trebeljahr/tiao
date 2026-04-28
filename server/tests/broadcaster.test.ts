import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import type { BroadcastChannel } from "../game/broadcaster";
import { InMemoryBroadcaster } from "../game/broadcaster";

describe("InMemoryBroadcaster", () => {
  let broadcaster: InMemoryBroadcaster;
  let received: Array<{ channel: BroadcastChannel; target: string | null; message: string }>;

  beforeEach(() => {
    broadcaster = new InMemoryBroadcaster();
    received = [];
    broadcaster.onMessage((channel, target, message) => {
      received.push({ channel, target, message });
    });
  });

  test("publishRoom delivers to handler with correct channel and target", () => {
    broadcaster.publishRoom("ROOM01", '{"type":"snapshot"}');
    assert.equal(received.length, 1);
    assert.equal(received[0]!.channel, "room");
    assert.equal(received[0]!.target, "ROOM01");
    assert.equal(received[0]!.message, '{"type":"snapshot"}');
  });

  test("publishLobby delivers to handler with correct channel and target", () => {
    broadcaster.publishLobby("player-123", '{"type":"game-update"}');
    assert.equal(received.length, 1);
    assert.equal(received[0]!.channel, "lobby");
    assert.equal(received[0]!.target, "player-123");
  });

  test("publishLobbyAll delivers to handler with null target", () => {
    broadcaster.publishLobbyAll('{"type":"player-identity-update"}');
    assert.equal(received.length, 1);
    assert.equal(received[0]!.channel, "lobby-all");
    assert.equal(received[0]!.target, null);
  });

  test("does not deliver when no handler is registered", () => {
    const fresh = new InMemoryBroadcaster();
    // Should not throw
    fresh.publishRoom("ROOM01", "data");
    fresh.publishLobby("player", "data");
    fresh.publishLobbyAll("data");
  });

  test("subscribe/unsubscribe are no-ops", () => {
    // Should not throw — cast to Broadcaster interface to call with args
    const b = broadcaster as import("../game/broadcaster").Broadcaster;
    b.subscribeRoom("ROOM01");
    b.unsubscribeRoom("ROOM01");
    b.subscribeLobby("player-123");
    b.unsubscribeLobby("player-123");
  });

  test("close clears handler", async () => {
    await broadcaster.close();
    broadcaster.publishRoom("ROOM01", "data");
    assert.equal(received.length, 0);
  });

  test("multiple publishes accumulate", () => {
    broadcaster.publishRoom("A", "msg1");
    broadcaster.publishLobby("B", "msg2");
    broadcaster.publishLobbyAll("msg3");
    assert.equal(received.length, 3);
  });
});
