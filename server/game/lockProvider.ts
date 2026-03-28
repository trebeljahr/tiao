import type Redis from "ioredis";
import { randomUUID } from "crypto";

export interface LockProvider {
  withLock<T>(key: string, operation: () => Promise<T>): Promise<T>;
}

const LOCK_TIMEOUT_MS = 15_000;

/**
 * Promise-chaining lock for single-instance deployments.
 * Operations on the same key are serialized in FIFO order.
 */
export class InMemoryLockProvider implements LockProvider {
  private readonly locks = new Map<string, Promise<void>>();

  async withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release: () => void = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });

    this.locks.set(key, current);

    await Promise.race([
      previous.catch(() => undefined),
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, LOCK_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);

    try {
      return await operation();
    } finally {
      release();
      if (this.locks.get(key) === current) {
        this.locks.delete(key);
      }
    }
  }
}

/**
 * Redis-based distributed lock using SETNX + TTL.
 * Supports multi-instance deployments.
 */
export class RedisLockProvider implements LockProvider {
  private static readonly RELEASE_SCRIPT = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;

  constructor(private readonly redis: Redis) {}

  async withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const lockKey = `tiao:lock:${key}`;
    const lockValue = randomUUID();
    const ttlSeconds = Math.ceil(LOCK_TIMEOUT_MS / 1000);

    // Retry acquiring the lock
    const maxAttempts = 30;
    const retryDelayMs = 500;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const acquired = await this.redis.set(lockKey, lockValue, "EX", ttlSeconds, "NX");

      if (acquired === "OK") {
        try {
          return await operation();
        } finally {
          await this.redis
            .eval(RedisLockProvider.RELEASE_SCRIPT, 1, lockKey, lockValue)
            .catch(() => {});
        }
      }

      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, retryDelayMs);
        timer.unref?.();
      });
    }

    throw new Error(`Failed to acquire lock "${key}" after ${maxAttempts} attempts.`);
  }
}
