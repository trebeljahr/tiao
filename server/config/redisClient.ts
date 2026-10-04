import Redis from "ioredis";
import { createLogger } from "../lib/logger";
import { REDIS_URL } from "./envVars";

const log = createLogger("redis");

let redisClient: Redis | null = null;

if (REDIS_URL && process.env.NODE_ENV !== "test") {
  redisClient = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: false,
    commandTimeout: 2_000,
  });

  // Full connection-state instrumentation. When production Redis flaps
  // (Cloudflare/Coolify network hops, Redis restart, etc.) we want the
  // state transitions visible in logs so debugging "why did matchmaking
  // hang for 30s" doesn't require inferring connection state from
  // collateral errors elsewhere.
  redisClient.on("connect", () => {
    log.info("tcp connect");
  });

  redisClient.on("ready", () => {
    log.info("ready");
  });

  redisClient.on("reconnecting", (delay: number) => {
    log.warn("reconnecting", { delayMs: delay });
  });

  redisClient.on("end", () => {
    log.warn("connection ended (no more reconnection attempts)");
  });

  redisClient.on("close", () => {
    log.warn("connection closed");
  });

  redisClient.on("error", (err: Error) => {
    // Don't ship every transient network error to GlitchTip — ioredis
    // retries automatically and these happen during normal reconnects.
    // Log via `warn` (no captureException) so we still see them in the
    // console. If it's a persistent failure, the `end` event will fire.
    log.warn("connection error", { message: err.message });
  });
}

export function getRedisClient(): Redis | null {
  return redisClient;
}
