import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type Redis from "ioredis";
import type { PlayerIdentity } from "../../shared/src";

export interface RoomPresence {
  join(connection: string, room: string, player: PlayerIdentity): Promise<void>;
  leave(connection: string): Promise<void>;
  hasConnection(room: string, connection: string): Promise<boolean>;
  connectionIds(room: string): Promise<string[]>;
  players(room: string): Promise<Map<string, PlayerIdentity>>;
  close(): Promise<void>;
  isReady(): boolean;
  onRecovery?(handler: () => void): void;
}

export class InMemoryRoomPresence implements RoomPresence {
  protected readonly connections = new Map<string, { room: string; player: PlayerIdentity }>();
  async join(connection: string, room: string, player: PlayerIdentity): Promise<void> {
    this.connections.set(connection, { room, player });
  }
  async leave(connection: string): Promise<void> {
    this.connections.delete(connection);
  }
  async hasConnection(room: string, connection: string): Promise<boolean> {
    return this.connections.get(connection)?.room === room;
  }
  async connectionIds(room: string): Promise<string[]> {
    return [...this.connections].filter(([, row]) => row.room === room).map(([id]) => id);
  }
  async players(room: string): Promise<Map<string, PlayerIdentity>> {
    return new Map(
      [...this.connections.values()]
        .filter((row) => row.room === room)
        .map((row) => [row.player.playerId, row.player]),
    );
  }
  async close(): Promise<void> {
    this.connections.clear();
  }
  isReady(): boolean {
    return true;
  }
}

/** Per-connection leases avoid one replica removing another replica's player. */
export class RedisRoomPresence extends InMemoryRoomPresence {
  private readonly instance = randomUUID();
  private readonly timer: ReturnType<typeof setInterval>;
  private renewing = false;
  private closed = false;
  private renewal: Promise<void> | undefined;
  private lastHeartbeat = performance.now();
  private recovery: (() => void) | undefined;
  private readonly members = new Map<string, string>();
  private static readonly TOUCH = `
    local t = redis.call('TIME')
    local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
    redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
    redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[1])
    redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]) * 2)
    return 1
  `;
  private static readonly READ = `
    local t = redis.call('TIME')
    local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
    redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
    return redis.call('ZRANGE', KEYS[1], 0, -1)
  `;
  constructor(
    private readonly redis: Redis,
    private readonly ttlMs = 15_000,
  ) {
    super();
    this.timer = setInterval(
      () => {
        if (this.closed || this.renewing || this.redis.status !== "ready") return;
        this.renewing = true;
        if (performance.now() - this.lastHeartbeat >= this.ttlMs) this.recovery?.();
        this.renewal = this.renew()
          .then(() => {
            if (performance.now() - this.lastHeartbeat >= this.ttlMs) this.recovery?.();
            this.lastHeartbeat = performance.now();
          })
          .catch(() => undefined)
          .finally(() => {
            this.renewing = false;
          });
      },
      Math.max(10, Math.floor(ttlMs / 3)),
    );
    this.timer.unref();
  }
  private key(room: string): string {
    return `tiao:presence:v2:${room}`;
  }
  private assertReady(): void {
    if (!this.isReady()) throw new Error("Shared room presence is unavailable");
  }
  private async renew(): Promise<void> {
    for (const [id, row] of this.connections) {
      const member = this.members.get(id);
      if (member) {
        await this.redis.eval(RedisRoomPresence.TOUCH, 1, this.key(row.room), member, this.ttlMs);
        if (this.members.get(id) !== member) await this.redis.zrem(this.key(row.room), member);
      }
    }
  }
  override async join(connection: string, room: string, player: PlayerIdentity): Promise<void> {
    this.assertReady();
    const member = JSON.stringify({
      connection: `${this.instance}:${connection}`,
      connectionId: connection,
      player,
    });
    await this.redis.eval(RedisRoomPresence.TOUCH, 1, this.key(room), member, this.ttlMs);
    if (this.closed) {
      await this.redis.zrem(this.key(room), member);
      throw new Error("Shared room presence closed during connection");
    }
    this.members.set(connection, member);
    await super.join(connection, room, player);
  }
  override async leave(connection: string): Promise<void> {
    const row = this.connections.get(connection);
    const member = this.members.get(connection);
    this.members.delete(connection);
    await super.leave(connection);
    if (row && member) {
      if (this.redis.status !== "ready") throw new Error("Shared room presence is unavailable");
      await this.redis.zrem(this.key(row.room), member);
    }
  }
  override async hasConnection(room: string, connection: string): Promise<boolean> {
    this.assertReady();
    const rows = (await this.redis.eval(RedisRoomPresence.READ, 1, this.key(room))) as string[];
    return rows.some(
      (raw) => (JSON.parse(raw) as { connectionId: string }).connectionId === connection,
    );
  }
  override async connectionIds(room: string): Promise<string[]> {
    this.assertReady();
    const rows = (await this.redis.eval(RedisRoomPresence.READ, 1, this.key(room))) as string[];
    return rows.map((raw) => (JSON.parse(raw) as { connectionId: string }).connectionId);
  }
  override async players(room: string): Promise<Map<string, PlayerIdentity>> {
    this.assertReady();
    const rows = (await this.redis.eval(RedisRoomPresence.READ, 1, this.key(room))) as string[];
    const players = new Map<string, PlayerIdentity>();
    for (const raw of rows) {
      const { player } = JSON.parse(raw) as { player: PlayerIdentity };
      players.set(player.playerId, player);
    }
    return players;
  }
  onRecovery(handler: () => void): void {
    this.recovery = handler;
  }
  override isReady(): boolean {
    return (
      !this.closed &&
      this.redis.status === "ready" &&
      performance.now() - this.lastHeartbeat < this.ttlMs
    );
  }
  override async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.timer);
    // Complete outstanding TOUCH calls before removing leases, otherwise a
    // delayed renewal can resurrect a connection after shutdown.
    await this.renewal;
    await Promise.allSettled([...this.connections.keys()].map((id) => this.leave(id)));
  }
}
