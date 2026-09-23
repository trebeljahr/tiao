/**
 * Daily Discord leaderboard.
 *
 * Once a day the job pulls the top 10 rated players and rewrites a single
 * pinned message in the game-results channel. On the very first run there
 * is no message yet, so it posts one, pins it, and remembers its id in the
 * AppSetting collection. Every later run edits that message in place; if
 * a moderator deleted it in the meantime (Discord answers 404 on the edit)
 * the job simply posts and pins a fresh one.
 *
 * The pure `runLeaderboardUpdate` takes every side effect as a dependency
 * so the create-then-edit behaviour can be unit-tested without Mongo or
 * the network. `startDiscordLeaderboardJob` wires the real Mongo query,
 * REST client and scheduler together at boot and is a no-op when the
 * Discord env vars are missing.
 */

import { Queue, Worker } from "bullmq";
import type { Redis } from "ioredis";
import { createLogger } from "../lib/logger";
import { getAppSetting, setAppSetting } from "../models/AppSetting";
import GameAccount from "../models/GameAccount";
import { createDiscordRest, type DiscordRest, DiscordRestError } from "./rest";

const log = createLogger("discord-leaderboard");

export const LEADERBOARD_MESSAGE_ID_KEY = "discord.leaderboard.messageId";
export const LEADERBOARD_SIZE = 10;

/** 06:00 UTC every day — after the European night, before the US morning. */
const DAILY_CRON = "0 6 * * *";
const DAY_MS = 24 * 60 * 60 * 1000;

export interface LeaderboardPlayer {
  displayName: string;
  elo: number;
  gamesPlayed: number;
}

export interface LeaderboardJobDeps {
  rest: DiscordRest;
  channelId: string;
  fetchTopPlayers(limit: number): Promise<LeaderboardPlayer[]>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  now?: () => Date;
}

export type LeaderboardUpdateResult = {
  action: "created" | "edited" | "recreated";
  messageId: string;
};

// ─── Formatting ────────────────────────────────────────────────────────

const MEDALS = ["🥇", "🥈", "🥉"];

/** Neutralise Discord markdown in user-supplied display names. */
function escapeMarkdown(text: string): string {
  return text.replace(/([\\*_~`|>])/g, "\\$1");
}

export function formatLeaderboard(players: LeaderboardPlayer[], now: Date): string {
  const lines = ["🏆 **Tiao leaderboard — top 10 by rating**", ""];

  if (players.length === 0) {
    lines.push("_No rated games yet. Play a ranked game to claim the first spot!_");
  }

  players.forEach((player, index) => {
    const rank = MEDALS[index] ?? `${index + 1}.`;
    const games = player.gamesPlayed === 1 ? "1 game" : `${player.gamesPlayed} games`;
    lines.push(`${rank} **${escapeMarkdown(player.displayName)}** — ${player.elo} (${games})`);
  });

  const stamp = now.toISOString().slice(0, 16).replace("T", " ");
  lines.push("", `_Updated ${stamp} UTC · refreshes daily_`);
  return lines.join("\n");
}

// ─── Core job ──────────────────────────────────────────────────────────

async function createAndPin(deps: LeaderboardJobDeps, content: string): Promise<string> {
  const message = await deps.rest.createMessage(deps.channelId, content);
  // Persist the id before pinning: if pinning fails (missing "Manage
  // Messages" permission) we still want to edit this message next time
  // instead of posting a duplicate every day.
  await deps.setSetting(LEADERBOARD_MESSAGE_ID_KEY, message.id);
  try {
    await deps.rest.pinMessage(deps.channelId, message.id);
  } catch (err) {
    log.warn("could not pin leaderboard message — check the bot's Manage Messages permission", {
      messageId: message.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return message.id;
}

export async function runLeaderboardUpdate(
  deps: LeaderboardJobDeps,
): Promise<LeaderboardUpdateResult> {
  const now = deps.now ? deps.now() : new Date();
  const players = await deps.fetchTopPlayers(LEADERBOARD_SIZE);
  const content = formatLeaderboard(players, now);

  const storedId = await deps.getSetting(LEADERBOARD_MESSAGE_ID_KEY);
  if (!storedId) {
    const messageId = await createAndPin(deps, content);
    return { action: "created", messageId };
  }

  try {
    await deps.rest.editMessage(deps.channelId, storedId, content);
    return { action: "edited", messageId: storedId };
  } catch (err) {
    // 404 = someone deleted the pinned message. Anything else (rate
    // limit, auth, outage) is a real failure — let the scheduler log it
    // and try again tomorrow rather than spamming a new message.
    if (!(err instanceof DiscordRestError && err.status === 404)) throw err;
    log.warn("stored leaderboard message is gone, posting a new one", { messageId: storedId });
    const messageId = await createAndPin(deps, content);
    return { action: "recreated", messageId };
  }
}

// ─── Real dependencies ─────────────────────────────────────────────────

export async function fetchTopPlayersFromDb(limit: number): Promise<LeaderboardPlayer[]> {
  const rows = (await GameAccount.find(
    { "rating.overall.gamesPlayed": { $gte: 1 } },
    { displayName: 1, "rating.overall.elo": 1, "rating.overall.gamesPlayed": 1 },
  )
    .sort({ "rating.overall.elo": -1, "rating.overall.gamesPlayed": -1, displayName: 1 })
    .limit(limit)
    .lean()) as unknown as Array<{
    displayName: string;
    rating?: { overall?: { elo?: number; gamesPlayed?: number } };
  }>;

  return rows.map((row) => ({
    displayName: row.displayName,
    elo: Math.round(row.rating?.overall?.elo ?? 0),
    gamesPlayed: row.rating?.overall?.gamesPlayed ?? 0,
  }));
}

export type LeaderboardEnv = {
  DISCORD_BOT_TOKEN?: string;
  DISCORD_CHANNEL_GAME_RESULTS?: string;
};

/**
 * Returns the job function, or null when Discord isn't configured. Both
 * env vars are required: the token authenticates the bot, the channel id
 * says where the pinned message lives.
 */
export function createLeaderboardJobFromEnv(
  env: LeaderboardEnv = process.env,
): (() => Promise<LeaderboardUpdateResult>) | null {
  const botToken = env.DISCORD_BOT_TOKEN?.trim();
  const channelId = env.DISCORD_CHANNEL_GAME_RESULTS?.trim();
  if (!botToken || !channelId) return null;

  const deps: LeaderboardJobDeps = {
    rest: createDiscordRest({ botToken }),
    channelId,
    fetchTopPlayers: fetchTopPlayersFromDb,
    getSetting: getAppSetting,
    setSetting: setAppSetting,
  };
  return () => runLeaderboardUpdate(deps);
}

// ─── Scheduling ────────────────────────────────────────────────────────

export interface DailyJobScheduler {
  /** Arm the schedule and kick off one immediate run. */
  start(): void;
  close(): Promise<void>;
}

async function runLogged(job: () => Promise<LeaderboardUpdateResult>): Promise<void> {
  try {
    const result = await job();
    log.info("leaderboard updated", result);
  } catch (err) {
    log.error("leaderboard update failed", err);
  }
}

/** Single-process fallback: run now, then every 24h. Used when Redis is absent. */
export class InMemoryDailyJobScheduler implements DailyJobScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly job: () => Promise<LeaderboardUpdateResult>) {}

  start(): void {
    if (this.timer) return;
    void runLogged(this.job);
    this.timer = setInterval(() => void runLogged(this.job), DAY_MS);
    if (this.timer.unref) this.timer.unref();
  }

  async close(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

const LEADERBOARD_QUEUE = "tiao-discord-leaderboard";

/**
 * Multi-instance scheduler. The BullMQ job scheduler stores the cron in
 * Redis, so however many server instances boot, exactly one delayed job
 * exists per day and whichever worker grabs it runs the update. Boot also
 * enqueues a one-off job so a fresh deploy posts the message right away.
 */
export class BullMQDailyJobScheduler implements DailyJobScheduler {
  private readonly queue: Queue;
  private readonly worker: Worker;
  private readonly workerConnection: Redis;

  constructor(redis: Redis, job: () => Promise<LeaderboardUpdateResult>) {
    this.workerConnection = redis.duplicate({
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    this.queue = new Queue(LEADERBOARD_QUEUE, { connection: redis });
    this.worker = new Worker(LEADERBOARD_QUEUE, () => runLogged(job), {
      connection: this.workerConnection,
      concurrency: 1,
    });
    this.worker.on("error", (err) => {
      log.error("worker error", err);
    });
  }

  start(): void {
    void (async () => {
      try {
        await this.queue.upsertJobScheduler(
          "daily",
          { pattern: DAILY_CRON, tz: "UTC" },
          { name: "update", opts: { removeOnComplete: true, removeOnFail: true } },
        );
        // Deduplicated by jobId while a boot job is still queued, so a
        // rolling restart of N instances doesn't post N edits in a row.
        await this.queue.add(
          "update",
          {},
          { jobId: "boot", removeOnComplete: true, removeOnFail: true },
        );
      } catch (err) {
        log.error("failed to arm schedule", err);
      }
    })();
  }

  async close(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
    await this.workerConnection.quit();
  }
}

/**
 * Boot hook. Returns null (and logs why) when Discord isn't configured.
 */
export function startDiscordLeaderboardJob(redis: Redis | null): DailyJobScheduler | null {
  const job = createLeaderboardJobFromEnv();
  if (!job) {
    log.info("DISCORD_BOT_TOKEN / DISCORD_CHANNEL_GAME_RESULTS not set — leaderboard job disabled");
    return null;
  }

  const scheduler = redis
    ? new BullMQDailyJobScheduler(redis, job)
    : new InMemoryDailyJobScheduler(job);
  scheduler.start();
  log.info("leaderboard job armed", { backend: redis ? "bullmq" : "in-memory" });
  return scheduler;
}
