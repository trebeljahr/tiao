import type Redis from "ioredis";
import type { PlayerIdentity, TimeControl } from "../../shared/src";
import { DEFAULT_RATING } from "./elo";

export type MatchmakingQueueEntry = {
  player: PlayerIdentity;
  queuedAt: number;
  timeControl: TimeControl;
  rating: number;
};

export interface MatchmakingStore {
  findEntry(playerId: string): Promise<MatchmakingQueueEntry | null>;
  findAndRemoveOpponent(
    playerId: string,
    timeControl: TimeControl,
    rating: number,
  ): Promise<MatchmakingQueueEntry | null>;
  addToQueue(entry: MatchmakingQueueEntry): Promise<void>;
  removeFromQueue(playerId: string): Promise<void>;
  setMatch(playerId: string, gameId: string): Promise<void>;
  getMatch(playerId: string): Promise<string | null>;
  deleteMatch(playerId: string): Promise<void>;
  getAllEntries(): Promise<MatchmakingQueueEntry[]>;
}

function timeControlsMatch(a: TimeControl, b: TimeControl): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.initialMs === b.initialMs && a.incrementMs === b.incrementMs;
}

/** Expanding window: starts at 100 Elo, grows by 25/second, capped at 1000. */
const BASE_WINDOW = 100;
const EXPANSION_PER_SECOND = 25;
const MAX_WINDOW = 1000;

function computeEloWindow(waitMs: number): number {
  const waitSeconds = waitMs / 1000;
  return Math.min(BASE_WINDOW + EXPANSION_PER_SECOND * waitSeconds, MAX_WINDOW);
}

function isEloEligible(
  candidateRating: number,
  candidateQueuedAt: number,
  incomingRating: number,
  now: number,
): boolean {
  const window = computeEloWindow(now - candidateQueuedAt);
  return Math.abs(incomingRating - candidateRating) <= window;
}

/**
 * In-memory matchmaking for single-instance deployments.
 */
export class InMemoryMatchmakingStore implements MatchmakingStore {
  private readonly queue: MatchmakingQueueEntry[] = [];
  private readonly matches = new Map<string, string>();

  async findEntry(playerId: string): Promise<MatchmakingQueueEntry | null> {
    return this.queue.find((e) => e.player.playerId === playerId) ?? null;
  }

  async findAndRemoveOpponent(
    playerId: string,
    timeControl: TimeControl,
    rating: number,
  ): Promise<MatchmakingQueueEntry | null> {
    const now = Date.now();
    let bestIndex = -1;
    let bestEloDiff = Infinity;

    for (let i = 0; i < this.queue.length; i++) {
      const e = this.queue[i];
      if (e.player.playerId === playerId) continue;
      if (!timeControlsMatch(e.timeControl, timeControl)) continue;

      const candidateRating = e.rating ?? DEFAULT_RATING;
      if (!isEloEligible(candidateRating, e.queuedAt, rating, now)) continue;

      const diff = Math.abs(rating - candidateRating);
      if (diff < bestEloDiff) {
        bestEloDiff = diff;
        bestIndex = i;
      }
    }

    if (bestIndex < 0) return null;
    return this.queue.splice(bestIndex, 1)[0];
  }

  async addToQueue(entry: MatchmakingQueueEntry): Promise<void> {
    this.queue.push(entry);
  }

  async removeFromQueue(playerId: string): Promise<void> {
    const index = this.queue.findIndex((e) => e.player.playerId === playerId);
    if (index >= 0) this.queue.splice(index, 1);
  }

  async setMatch(playerId: string, gameId: string): Promise<void> {
    this.matches.set(playerId, gameId);
  }

  async getMatch(playerId: string): Promise<string | null> {
    return this.matches.get(playerId) ?? null;
  }

  async deleteMatch(playerId: string): Promise<void> {
    this.matches.delete(playerId);
  }

  async getAllEntries(): Promise<MatchmakingQueueEntry[]> {
    return [...this.queue];
  }
}

const QUEUE_KEY = "tiao:matchmaking:queue";
const MATCH_PREFIX = "tiao:matchmaking:match:";
const MATCH_TTL_SECONDS = 300;

/**
 * Redis-backed matchmaking for multi-instance deployments.
 * Queue uses a Sorted Set (score = queuedAt). Matches use String + TTL.
 */
export class RedisMatchmakingStore implements MatchmakingStore {
  constructor(private readonly redis: Redis) {}

  async findEntry(playerId: string): Promise<MatchmakingQueueEntry | null> {
    const members = await this.redis.zrange(QUEUE_KEY, 0, -1);
    for (const raw of members) {
      const entry = JSON.parse(raw) as MatchmakingQueueEntry;
      if (entry.player.playerId === playerId) return entry;
    }
    return null;
  }

  async findAndRemoveOpponent(
    playerId: string,
    timeControl: TimeControl,
    rating: number,
  ): Promise<MatchmakingQueueEntry | null> {
    const now = Date.now();
    const members = await this.redis.zrange(QUEUE_KEY, 0, -1);

    let bestRaw: string | null = null;
    let bestEntry: MatchmakingQueueEntry | null = null;
    let bestEloDiff = Infinity;

    for (const raw of members) {
      const entry = JSON.parse(raw) as MatchmakingQueueEntry;
      if (entry.player.playerId === playerId) continue;
      if (!timeControlsMatch(entry.timeControl, timeControl)) continue;

      const candidateRating = entry.rating ?? DEFAULT_RATING;
      if (!isEloEligible(candidateRating, entry.queuedAt, rating, now)) continue;

      const diff = Math.abs(rating - candidateRating);
      if (diff < bestEloDiff) {
        bestEloDiff = diff;
        bestRaw = raw;
        bestEntry = entry;
      }
    }

    if (!bestRaw || !bestEntry) return null;
    const removed = await this.redis.zrem(QUEUE_KEY, bestRaw);
    if (removed > 0) return bestEntry;
    return null;
  }

  async addToQueue(entry: MatchmakingQueueEntry): Promise<void> {
    await this.redis.zadd(QUEUE_KEY, entry.queuedAt, JSON.stringify(entry));
  }

  async removeFromQueue(playerId: string): Promise<void> {
    const members = await this.redis.zrange(QUEUE_KEY, 0, -1);
    for (const raw of members) {
      const entry = JSON.parse(raw) as MatchmakingQueueEntry;
      if (entry.player.playerId === playerId) {
        await this.redis.zrem(QUEUE_KEY, raw);
        return;
      }
    }
  }

  async setMatch(playerId: string, gameId: string): Promise<void> {
    await this.redis.set(`${MATCH_PREFIX}${playerId}`, gameId, "EX", MATCH_TTL_SECONDS);
  }

  async getMatch(playerId: string): Promise<string | null> {
    return this.redis.get(`${MATCH_PREFIX}${playerId}`);
  }

  async deleteMatch(playerId: string): Promise<void> {
    await this.redis.del(`${MATCH_PREFIX}${playerId}`);
  }

  async getAllEntries(): Promise<MatchmakingQueueEntry[]> {
    const members = await this.redis.zrange(QUEUE_KEY, 0, -1);
    return members.map((raw) => JSON.parse(raw) as MatchmakingQueueEntry);
  }
}
