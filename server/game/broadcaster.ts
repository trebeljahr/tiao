import { randomUUID } from "node:crypto";
import type Redis from "ioredis";

export type BroadcastChannel = "room" | "lobby" | "lobby-all";

export type BroadcastHandler = (
  channel: BroadcastChannel,
  /** roomId for "room", playerId for "lobby", null for "lobby-all" */
  target: string | null,
  message: string,
) => void;

export interface Broadcaster {
  publishRoom(roomId: string, message: string): void;
  publishLobby(playerId: string, message: string): void;
  publishLobbyAll(message: string): void;
  subscribeRoom(roomId: string): void;
  unsubscribeRoom(roomId: string): void;
  subscribeLobby(playerId: string): void;
  unsubscribeLobby(playerId: string): void;
  onMessage(handler: BroadcastHandler): void;
  close(): Promise<void>;
}

/**
 * Single-instance broadcaster — delivers messages directly in-process.
 * Subscribe/unsubscribe are no-ops since there is nothing to coordinate.
 */
export class InMemoryBroadcaster implements Broadcaster {
  private handler: BroadcastHandler | null = null;

  publishRoom(roomId: string, message: string): void {
    this.handler?.("room", roomId, message);
  }

  publishLobby(playerId: string, message: string): void {
    this.handler?.("lobby", playerId, message);
  }

  publishLobbyAll(message: string): void {
    this.handler?.("lobby-all", null, message);
  }

  subscribeRoom(): void {}
  unsubscribeRoom(): void {}
  subscribeLobby(): void {}
  unsubscribeLobby(): void {}

  onMessage(handler: BroadcastHandler): void {
    this.handler = handler;
  }

  async close(): Promise<void> {
    this.handler = null;
  }
}

const ROOM_PREFIX = "tiao:ws:room:";
const LOBBY_PREFIX = "tiao:ws:lobby:";
const LOBBY_ALL_CHANNEL = "tiao:ws:lobby:all";

interface Envelope {
  /** Instance ID — used to discard self-published messages. */
  iid: string;
  data: string;
}

/**
 * Redis Pub/Sub broadcaster for multi-instance deployments.
 * Each instance subscribes to channels for rooms/players it has active
 * connections for. Messages include an instance ID so a publisher
 * doesn't echo its own messages back to itself.
 *
 * Requires a dedicated subscriber connection because ioredis switches
 * to subscriber mode and can no longer issue regular commands.
 */
export class RedisBroadcaster implements Broadcaster {
  private readonly instanceId = randomUUID();
  private readonly subscriber: Redis;
  private handler: BroadcastHandler | null = null;

  constructor(private readonly publisher: Redis) {
    // Duplicate the connection for subscribing — subscriber mode is exclusive
    this.subscriber = publisher.duplicate();

    // Always listen to the global lobby channel
    void this.subscriber.subscribe(LOBBY_ALL_CHANNEL);

    this.subscriber.on("message", (channel: string, raw: string) => {
      if (!this.handler) return;

      let envelope: Envelope;
      try {
        envelope = JSON.parse(raw) as Envelope;
      } catch {
        return;
      }

      // Anti-echo: skip messages we published ourselves
      if (envelope.iid === this.instanceId) return;

      if (channel === LOBBY_ALL_CHANNEL) {
        this.handler("lobby-all", null, envelope.data);
      } else if (channel.startsWith(ROOM_PREFIX)) {
        this.handler("room", channel.slice(ROOM_PREFIX.length), envelope.data);
      } else if (channel.startsWith(LOBBY_PREFIX)) {
        this.handler("lobby", channel.slice(LOBBY_PREFIX.length), envelope.data);
      }
    });
  }

  private envelope(data: string): string {
    return JSON.stringify({ iid: this.instanceId, data } satisfies Envelope);
  }

  publishRoom(roomId: string, message: string): void {
    // Deliver locally first (synchronous, no Redis round-trip for local sockets)
    this.handler?.("room", roomId, message);
    void this.publisher.publish(ROOM_PREFIX + roomId, this.envelope(message));
  }

  publishLobby(playerId: string, message: string): void {
    this.handler?.("lobby", playerId, message);
    void this.publisher.publish(LOBBY_PREFIX + playerId, this.envelope(message));
  }

  publishLobbyAll(message: string): void {
    this.handler?.("lobby-all", null, message);
    void this.publisher.publish(LOBBY_ALL_CHANNEL, this.envelope(message));
  }

  subscribeRoom(roomId: string): void {
    void this.subscriber.subscribe(ROOM_PREFIX + roomId);
  }

  unsubscribeRoom(roomId: string): void {
    void this.subscriber.unsubscribe(ROOM_PREFIX + roomId);
  }

  subscribeLobby(playerId: string): void {
    void this.subscriber.subscribe(LOBBY_PREFIX + playerId);
  }

  unsubscribeLobby(playerId: string): void {
    void this.subscriber.unsubscribe(LOBBY_PREFIX + playerId);
  }

  onMessage(handler: BroadcastHandler): void {
    this.handler = handler;
  }

  async close(): Promise<void> {
    this.handler = null;
    await this.subscriber.quit();
  }
}
