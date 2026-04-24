import type { Request } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { getPlayerFromRequest } from "../auth/sessionHelper";
import { getRedisClient } from "../config/redisClient";

const isTest = process.env.NODE_ENV === "test";

function createStore(prefix: string) {
  const redis = getRedisClient();
  if (!redis) return undefined; // falls back to built-in MemoryStore

  // Dynamic import to avoid requiring rate-limit-redis when Redis is off
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { RedisStore } = require("rate-limit-redis");
    return new RedisStore({
      sendCommand: (...args: string[]) => redis.call(...(args as [string, ...string[]])),
      prefix,
    });
  } catch {
    console.warn("[rate-limit] rate-limit-redis not available, using in-memory store.");
    return undefined;
  }
}

/**
 * Key generator that uses playerId for authenticated requests
 * and falls back to IP for unauthenticated ones.
 */
async function perAccountKey(req: Request): Promise<string> {
  try {
    const player = await getPlayerFromRequest(req);
    if (player) return `pid:${player.playerId}`;
  } catch {
    // Fall through to IP
  }
  return `ip:${ipKeyGenerator(req.ip ?? "127.0.0.1")}`;
}

export const authRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: createStore("tiao:rl:auth:"),
  keyGenerator: perAccountKey,
  validate: !isTest,
  message: {
    code: "RATE_LIMITED",
    message: "Too many attempts. Please try again later.",
  },
});

/** Game creation / joining: 20 requests per minute per player/IP. */
export const gameActionRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: createStore("tiao:rl:game:"),
  keyGenerator: perAccountKey,
  validate: !isTest,
  message: {
    code: "RATE_LIMITED",
    message: "Too many game requests. Please slow down.",
  },
});

export const userSearchRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 50,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: createStore("tiao:rl:search:"),
  keyGenerator: perAccountKey,
  validate: !isTest,
  message: {
    code: "RATE_LIMITED",
    message: "Too many search requests. Please try again later.",
  },
});
