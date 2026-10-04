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
  isReady?(): boolean;
  onRecovery?(handler: () => void): void;
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
  private recovery: (() => void) | null = null;
  private readonly channels = new Set([LOBBY_ALL_CHANNEL]);
  private ready = false;
  private generation = 0;
  private closed = false;

  constructor(private readonly publisher: Redis) {
    this.subscriber = publisher.duplicate({ enableOfflineQueue: false });
    this.subscriber.on("ready", () => {
      void this.restore();
    });
    this.subscriber.on("close", this.lost);
    this.subscriber.on("error", this.lost);
    this.publisher.on("close", this.lost);
    this.publisher.on("error", this.lost);
    this.publisher.on("ready", this.publisherReady);
    this.subscriber.on("message", (channel: string, raw: string) => {
      if (!this.handler || !this.isReady()) return;
      let envelope: Envelope;
      try {
        envelope = JSON.parse(raw) as Envelope;
      } catch {
        return;
      }
      if (envelope.iid === this.instanceId || typeof envelope.data !== "string") return;
      if (channel === LOBBY_ALL_CHANNEL) this.handler("lobby-all", null, envelope.data);
      else if (channel.startsWith(ROOM_PREFIX))
        this.handler("room", channel.slice(ROOM_PREFIX.length), envelope.data);
      else if (channel.startsWith(LOBBY_PREFIX))
        this.handler("lobby", channel.slice(LOBBY_PREFIX.length), envelope.data);
    });
  }

  private readonly lost = (): void => {
    if (this.closed) return;
    const wasReady = this.ready;
    this.ready = false;
    this.generation += 1;
    // Pub/Sub can lose messages during an outage. Existing TCP sockets cannot
    // infer the gap: force the normal reconnect+authoritative-snapshot path.
    if (wasReady) this.recovery?.();
  };
  private readonly publisherReady = (): void => {
    void this.restore();
  };
  private async restore(): Promise<void> {
    if (this.closed || this.publisher.status !== "ready" || this.subscriber.status !== "ready")
      return;
    const generation = ++this.generation;
    try {
      await this.subscriber.subscribe(...this.channels);
      if (generation !== this.generation || this.closed) return;
      this.ready = true;
      this.recovery?.();
    } catch {
      this.lost();
    }
  }
  isReady(): boolean {
    return this.ready && this.publisher.status === "ready" && this.subscriber.status === "ready";
  }
  onRecovery(handler: () => void): void {
    this.recovery = handler;
  }
  private publish(
    channel: BroadcastChannel,
    target: string | null,
    redisChannel: string,
    message: string,
  ): void {
    if (!this.isReady()) {
      this.recovery?.();
      return;
    }
    this.handler?.(channel, target, message);
    void this.publisher
      .publish(
        redisChannel,
        JSON.stringify({ iid: this.instanceId, data: message } satisfies Envelope),
      )
      .catch(this.lost);
  }
  publishRoom(roomId: string, message: string): void {
    this.publish("room", roomId, ROOM_PREFIX + roomId, message);
  }
  publishLobby(playerId: string, message: string): void {
    this.publish("lobby", playerId, LOBBY_PREFIX + playerId, message);
  }
  publishLobbyAll(message: string): void {
    this.publish("lobby-all", null, LOBBY_ALL_CHANNEL, message);
  }
  private subscribe(channel: string): void {
    this.channels.add(channel);
    if (this.subscriber.status === "ready")
      void this.subscriber.subscribe(channel).catch(this.lost);
  }
  private unsubscribe(channel: string): void {
    this.channels.delete(channel);
    if (this.subscriber.status === "ready")
      void this.subscriber.unsubscribe(channel).catch(this.lost);
  }
  subscribeRoom(roomId: string): void {
    this.subscribe(ROOM_PREFIX + roomId);
  }
  unsubscribeRoom(roomId: string): void {
    this.unsubscribe(ROOM_PREFIX + roomId);
  }
  subscribeLobby(playerId: string): void {
    this.subscribe(LOBBY_PREFIX + playerId);
  }
  unsubscribeLobby(playerId: string): void {
    this.unsubscribe(LOBBY_PREFIX + playerId);
  }
  onMessage(handler: BroadcastHandler): void {
    this.handler = handler;
  }
  async close(): Promise<void> {
    this.closed = true;
    this.ready = false;
    this.handler = null;
    this.publisher.off("close", this.lost);
    this.publisher.off("error", this.lost);
    this.publisher.off("ready", this.publisherReady);
    this.subscriber.disconnect();
  }
}
