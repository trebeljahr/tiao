import type Redis from "ioredis";
import { randomBytes } from "node:crypto";
import { getRedisClient } from "../config/redisClient";

/**
 * Short-lived exchange code storage for the desktop OAuth bridge.
 *
 * When a user signs in via the system browser we can't hand the
 * session token directly back to the Electron app — the only channel
 * between the browser and the app is a `tiao://` deep link, which
 * ends up in system-wide URL history (Windows recent apps, etc.) and
 * can in theory be sniffed by other processes.
 *
 * The safer pattern is the OAuth "code exchange" flow:
 *
 *   1. Server generates a random short-lived `code`
 *   2. Server stores (state, code) → userId in this store with a
 *      ~5-minute TTL
 *   3. Server redirects the browser to tiao://auth/complete?state=X&code=Y
 *   4. Electron receives the URL and POSTs {state, code} to
 *      /api/auth/desktop/exchange over HTTPS
 *   5. The exchange endpoint atomically consumes the entry and mints
 *      a real bearer token
 *
 * The code never leaves the HTTPS channel between the Electron main
 * process and api.playtiao.com.  Even if an attacker sniffs the
 * `tiao://` URL, they have <5 minutes to race us AND they need to
 * control a process on the same machine that can POST to our API.
 *
 * Both in-memory (single-instance / test) and Redis (multi-instance)
 * implementations follow the same ADR #2 pattern used by
 * matchmakingStore / lockProvider.
 */

export type ExchangeCodeEntry = {
  userId: string;
  code: string;
};

export interface ExchangeCodeStore {
  /**
   * Put a new exchange code entry.  Overwrites any existing entry for
   * the same state — useful for retries.
   */
  put(state: string, code: string, userId: string, ttlSec: number): Promise<void>;

  /**
   * Atomically consume the entry for `state`.  Returns the stored
   * userId if the entry exists AND the provided code matches.  Returns
   * null otherwise.  The entry is deleted on any successful or failed
   * match so a single leaked code can only be redeemed once.
   */
  consume(state: string, code: string): Promise<string | null>;
}

const KEY_PREFIX = "tiao:desktop:exchange:";

/**
 * In-memory implementation for single-instance deploys and tests.
 * Entries are stored in a Map with setTimeout-based expiry.
 */
export class InMemoryExchangeCodeStore implements ExchangeCodeStore {
  private readonly entries = new Map<string, { entry: ExchangeCodeEntry; timer: NodeJS.Timeout }>();

  async put(state: string, code: string, userId: string, ttlSec: number): Promise<void> {
    const existing = this.entries.get(state);
    if (existing) clearTimeout(existing.timer);

    const timer = setTimeout(() => {
      this.entries.delete(state);
    }, ttlSec * 1000);
    // Don't keep the Node.js event loop alive just for pending exchange
    // entries — we're fine with them being cleaned up when the process
    // exits, and the unref() avoids blocking graceful shutdown.
    timer.unref?.();

    this.entries.set(state, { entry: { userId, code }, timer });
  }

  async consume(state: string, code: string): Promise<string | null> {
    const slot = this.entries.get(state);
    if (!slot) return null;

    // Delete first — single-use semantics apply even if the caller
    // supplied the wrong code (which is almost certainly an attack).
    clearTimeout(slot.timer);
    this.entries.delete(state);

    if (slot.entry.code !== code) return null;
    return slot.entry.userId;
  }
}

/**
 * Redis-backed implementation for multi-instance deploys.
 * Uses SET NX EX for write + GETDEL for atomic consume.
 */
export class RedisExchangeCodeStore implements ExchangeCodeStore {
  constructor(private readonly redis: Redis) {}

  async put(state: string, code: string, userId: string, ttlSec: number): Promise<void> {
    const key = KEY_PREFIX + state;
    const value = JSON.stringify({ userId, code } satisfies ExchangeCodeEntry);
    await this.redis.set(key, value, "EX", ttlSec);
  }

  async consume(state: string, code: string): Promise<string | null> {
    const key = KEY_PREFIX + state;
    // GETDEL is atomic in Redis 6.2+.  On older Redis, ioredis will
    // emit a command error and we'd need a Lua fallback — but the
    // project already requires Redis 6.2+ (matchmakingStore uses
    // ZRANGEBYSCORE and similar newer commands).
    const raw = (await this.redis.call("GETDEL", key)) as string | null;
    if (!raw) return null;
    let entry: ExchangeCodeEntry;
    try {
      entry = JSON.parse(raw) as ExchangeCodeEntry;
    } catch {
      return null;
    }
    if (!entry || entry.code !== code) return null;
    return entry.userId;
  }
}

// ---------------------------------------------------------------------------
// Factory + convenience helpers
// ---------------------------------------------------------------------------

let storeSingleton: ExchangeCodeStore | null = null;

/**
 * Return the process-wide exchange code store.  Uses Redis when the
 * shared client is available, otherwise falls back to in-memory.
 *
 * Exported for tests to reset between runs.
 */
export function getExchangeCodeStore(): ExchangeCodeStore {
  if (storeSingleton) return storeSingleton;
  const redis = getRedisClient();
  storeSingleton = redis ? new RedisExchangeCodeStore(redis) : new InMemoryExchangeCodeStore();
  return storeSingleton;
}

/** Test-only: replace the singleton with a fresh in-memory instance. */
export function resetExchangeCodeStoreForTests(): void {
  storeSingleton = new InMemoryExchangeCodeStore();
}

/**
 * Generate a fresh exchange code — 32 random bytes encoded as base64url
 * (256 bits of entropy, far beyond what any brute-force attack could
 * cover in the 5-minute TTL).  The state is always chosen by the
 * desktop client in /start so that /callback can echo it back
 * unchanged.
 */
export function generateCode(): string {
  return randomBytes(32).toString("base64url");
}

export const DEFAULT_EXCHANGE_TTL_SEC = 5 * 60;
