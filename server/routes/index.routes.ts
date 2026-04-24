import express from "express";
import type { NextFunction, Request, Response } from "express";
import { getRedisClient } from "../config/redisClient";
import { isDatabaseReady } from "../db";

const router = express.Router();

router.get("/", (_: Request, res: Response, _next: NextFunction) => {
  res.json("All good in here");
});

const REDIS_PING_TIMEOUT_MS = 500;

/**
 * Ping Redis with a short timeout so the health endpoint can't hang
 * behind a stalled connection. If Redis isn't configured (dev without
 * REDIS_URL) we return "not-configured" which still counts as healthy
 * — the in-memory fallbacks cover that case. If Redis IS configured
 * and the ping fails or times out, we return 503 so the load balancer
 * / docker healthcheck pulls this instance out of rotation.
 */
async function checkRedis(): Promise<"ok" | "not-configured" | "down"> {
  const redis = getRedisClient();
  if (!redis) return "not-configured";

  try {
    const result = await Promise.race([
      redis.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("redis ping timeout")), REDIS_PING_TIMEOUT_MS),
      ),
    ]);
    return result === "PONG" ? "ok" : "down";
  } catch {
    return "down";
  }
}

router.get("/health", async (_: Request, res: Response) => {
  const databaseReady = isDatabaseReady();
  const redisState = await checkRedis();

  // Healthy means: Mongo is connected AND Redis is either not-configured
  // (in-memory mode) or actually responding. "down" means Redis was
  // configured but is unreachable — that's a real outage for the
  // Redis-backed matchmaking/timers/broadcast paths.
  const redisHealthy = redisState !== "down";
  const healthy = databaseReady && redisHealthy;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "starting",
    database: databaseReady ? "connected" : "disconnected",
    redis: redisState,
  });
});

export default router;
