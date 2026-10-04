import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type Redis from "ioredis";
import { withLockLease } from "./lockContext";

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

    await previous.catch(() => undefined);

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

  private static readonly RENEW_SCRIPT = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("pexpire", KEYS[1], ARGV[2])
    end
    return 0
  `;

  constructor(
    private readonly redis: Redis,
    private readonly options: {
      ttlMs?: number;
      retryMs?: number;
      /** Claim the durable store's fencing token before entering the operation. */
      claim?: (key: string, token: string) => Promise<void>;
    } = {},
  ) {}

  async withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const lockKey = `tiao:lock:${key}`;
    const token = randomUUID();
    const ttlMs = this.options.ttlMs ?? LOCK_TIMEOUT_MS;
    const retryMs = this.options.retryMs ?? 500;
    const until = performance.now() + LOCK_TIMEOUT_MS;
    do {
      if (this.redis.status !== "ready") throw new Error("Game authority is unavailable");
      const sentAt = performance.now();
      const acquired = await this.redis.set(lockKey, token, "PX", ttlMs, "NX");
      if (acquired === "OK") {
        let deadline = sentAt + ttlMs;
        let lost = false;
        let renewing: Promise<void> | undefined;
        const assertCurrent = async (): Promise<void> => {
          if (lost || performance.now() >= deadline || this.redis.status !== "ready") {
            lost = true;
            throw new Error("Game authority lease expired");
          }
          if ((await this.redis.get(lockKey)) !== token || performance.now() >= deadline) {
            lost = true;
            throw new Error("Game authority lease was replaced");
          }
        };
        const renew = async (): Promise<void> => {
          const began = performance.now();
          try {
            if (lost || began >= deadline || this.redis.status !== "ready")
              throw new Error("lost lease");
            const renewed = await this.redis.eval(
              RedisLockProvider.RENEW_SCRIPT,
              1,
              lockKey,
              token,
              ttlMs,
            );
            if (renewed !== 1 || performance.now() >= deadline) throw new Error("lost lease");
            deadline = began + ttlMs;
          } catch {
            lost = true;
          }
        };
        const timer = setInterval(
          () => {
            renewing ??= renew().finally(() => {
              renewing = undefined;
            });
          },
          Math.max(10, Math.floor(ttlMs / 3)),
        );
        timer.unref();
        try {
          return await withLockLease({ key, token, assertCurrent }, async () => {
            await assertCurrent();
            await this.options.claim?.(key, token);
            await assertCurrent();
            const result = await operation();
            await assertCurrent();
            return result;
          });
        } finally {
          clearInterval(timer);
          await renewing;
          await this.redis
            .eval(RedisLockProvider.RELEASE_SCRIPT, 1, lockKey, token)
            .catch(() => undefined);
        }
      }
      await new Promise<void>((resolve) => setTimeout(resolve, retryMs));
    } while (performance.now() < until);
    throw new Error("Timed out waiting for game authority");
  }
}
