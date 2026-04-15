import { Queue, Worker } from "bullmq";
import type { Redis } from "ioredis";

// BullMQ Workers do blocking commands (BRPOPLPUSH, etc.) that don't tolerate
// the default ioredis retry policy. The shared Redis client is configured with
// `maxRetriesPerRequest: 3` for fail-fast semantics in the rest of the app, so
// each BullMQ scheduler duplicates the connection here with the BullMQ-required
// options instead of mutating the shared client.
function duplicateForBullMQ(redis: Redis): Redis {
  return redis.duplicate({
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

// BullMQ ErrorCode.JobLockNotExist — surfaces as "Missing lock for job ..."
// from the worker's completion/fail path when the job lock has been lost
// (e.g. stalled-check reassigned it while we were processing, or the lock
// expired during a backlog drain on restart). For the queues we run — timers
// and a stateless matchmaking sweep — losing the finalize is harmless: the
// work already happened, the sweep is idempotent, and timer jobs are guarded
// by our own idempotency checks upstream. We silently drop these so they
// don't fill GlitchTip and local dev logs.
const JOB_LOCK_NOT_EXIST = -2;

function attachWorkerErrorHandler(worker: Worker, queueName: string): void {
  worker.on("error", (err) => {
    const code = (err as { code?: number }).code;
    if (code === JOB_LOCK_NOT_EXIST) return;
    console.error(`[bullmq:${queueName}] worker error:`, err);
  });
}

// ─── Handler callbacks provided by GameService ─────────────────────────

export type TimerHandlers = {
  onClockExpired(roomId: string, expectedTurn: string): Promise<void>;
  onAbandonExpired(roomId: string, playerId: string): Promise<void>;
  onFirstMoveExpired(roomId: string): Promise<void>;
};

// ─── TimerScheduler interface ──────────────────────────────────────────

export interface TimerScheduler {
  scheduleClockTimer(roomId: string, delayMs: number, expectedTurn: string): Promise<void>;
  cancelClockTimer(roomId: string): Promise<void>;
  scheduleAbandonTimer(roomId: string, playerId: string, delayMs: number): Promise<void>;
  cancelAbandonTimer(roomId: string, playerId: string): Promise<void>;
  scheduleFirstMoveTimer(roomId: string, delayMs: number): Promise<void>;
  cancelFirstMoveTimer(roomId: string): Promise<void>;
  /** Returns true if timers are persisted externally (no restart recovery needed). */
  isPersistent(): boolean;
  close(): Promise<void>;
}

// ─── InMemoryTimerScheduler ────────────────────────────────────────────

export class InMemoryTimerScheduler implements TimerScheduler {
  private readonly clockTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly abandonTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly firstMoveTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly handlers: TimerHandlers) {}

  async scheduleClockTimer(roomId: string, delayMs: number, expectedTurn: string): Promise<void> {
    this.cancelClockTimerSync(roomId);
    const timer = setTimeout(() => {
      void this.handlers.onClockExpired(roomId, expectedTurn);
    }, delayMs);
    timer.unref?.();
    this.clockTimers.set(roomId, timer);
  }

  async cancelClockTimer(roomId: string): Promise<void> {
    this.cancelClockTimerSync(roomId);
  }

  private cancelClockTimerSync(roomId: string): void {
    const timer = this.clockTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.clockTimers.delete(roomId);
    }
  }

  async scheduleAbandonTimer(roomId: string, playerId: string, delayMs: number): Promise<void> {
    const key = `${roomId}:${playerId}`;
    if (this.abandonTimers.has(key)) return;
    const timer = setTimeout(() => {
      this.abandonTimers.delete(key);
      void this.handlers.onAbandonExpired(roomId, playerId);
    }, delayMs);
    timer.unref?.();
    this.abandonTimers.set(key, timer);
  }

  async cancelAbandonTimer(roomId: string, playerId: string): Promise<void> {
    const key = `${roomId}:${playerId}`;
    const timer = this.abandonTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.abandonTimers.delete(key);
    }
  }

  async scheduleFirstMoveTimer(roomId: string, delayMs: number): Promise<void> {
    this.cancelFirstMoveTimerSync(roomId);
    const timer = setTimeout(() => {
      this.firstMoveTimers.delete(roomId);
      void this.handlers.onFirstMoveExpired(roomId);
    }, delayMs);
    timer.unref?.();
    this.firstMoveTimers.set(roomId, timer);
  }

  async cancelFirstMoveTimer(roomId: string): Promise<void> {
    this.cancelFirstMoveTimerSync(roomId);
  }

  private cancelFirstMoveTimerSync(roomId: string): void {
    const timer = this.firstMoveTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.firstMoveTimers.delete(roomId);
    }
  }

  isPersistent(): boolean {
    return false;
  }

  async close(): Promise<void> {
    for (const timer of this.clockTimers.values()) clearTimeout(timer);
    for (const timer of this.abandonTimers.values()) clearTimeout(timer);
    for (const timer of this.firstMoveTimers.values()) clearTimeout(timer);
    this.clockTimers.clear();
    this.abandonTimers.clear();
    this.firstMoveTimers.clear();
  }
}

// ─── BullMQTimerScheduler ──────────────────────────────────────────────

// BullMQ forbids `:` in queue names since it's the Redis key separator.
// Use `-` instead.
const CLOCK_QUEUE = "tiao-timer-clock";
const ABANDON_QUEUE = "tiao-timer-abandon";
const FIRST_MOVE_QUEUE = "tiao-timer-first-move";

export class BullMQTimerScheduler implements TimerScheduler {
  private readonly clockQueue: Queue;
  private readonly abandonQueue: Queue;
  private readonly firstMoveQueue: Queue;
  private readonly clockWorker: Worker;
  private readonly abandonWorker: Worker;
  private readonly firstMoveWorker: Worker;
  private readonly workerConnection: Redis;

  constructor(redis: Redis, handlers: TimerHandlers) {
    this.workerConnection = duplicateForBullMQ(redis);
    const queueConnection = { connection: redis };
    const workerConnection = { connection: this.workerConnection };

    this.clockQueue = new Queue(CLOCK_QUEUE, queueConnection);
    this.abandonQueue = new Queue(ABANDON_QUEUE, queueConnection);
    this.firstMoveQueue = new Queue(FIRST_MOVE_QUEUE, queueConnection);

    this.clockWorker = new Worker(
      CLOCK_QUEUE,
      async (job) => {
        const { roomId, expectedTurn } = job.data as { roomId: string; expectedTurn: string };
        await handlers.onClockExpired(roomId, expectedTurn);
      },
      { ...workerConnection, concurrency: 1 },
    );
    attachWorkerErrorHandler(this.clockWorker, CLOCK_QUEUE);

    this.abandonWorker = new Worker(
      ABANDON_QUEUE,
      async (job) => {
        const { roomId, playerId } = job.data as { roomId: string; playerId: string };
        await handlers.onAbandonExpired(roomId, playerId);
      },
      { ...workerConnection, concurrency: 1 },
    );
    attachWorkerErrorHandler(this.abandonWorker, ABANDON_QUEUE);

    this.firstMoveWorker = new Worker(
      FIRST_MOVE_QUEUE,
      async (job) => {
        const { roomId } = job.data as { roomId: string };
        await handlers.onFirstMoveExpired(roomId);
      },
      { ...workerConnection, concurrency: 1 },
    );
    attachWorkerErrorHandler(this.firstMoveWorker, FIRST_MOVE_QUEUE);
  }

  async scheduleClockTimer(roomId: string, delayMs: number, expectedTurn: string): Promise<void> {
    const jobId = `clock:${roomId}`;
    // Remove any existing timer for this room, then add with new delay
    await this.clockQueue.remove(jobId).catch(() => {});
    await this.clockQueue.add(
      "clock-expiry",
      { roomId, expectedTurn },
      {
        jobId,
        delay: delayMs,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  async cancelClockTimer(roomId: string): Promise<void> {
    await this.clockQueue.remove(`clock:${roomId}`).catch(() => {});
  }

  async scheduleAbandonTimer(roomId: string, playerId: string, delayMs: number): Promise<void> {
    const jobId = `abandon:${roomId}:${playerId}`;
    await this.abandonQueue.add(
      "guest-abandon",
      { roomId, playerId },
      {
        jobId,
        delay: delayMs,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  async cancelAbandonTimer(roomId: string, playerId: string): Promise<void> {
    await this.abandonQueue.remove(`abandon:${roomId}:${playerId}`).catch(() => {});
  }

  async scheduleFirstMoveTimer(roomId: string, delayMs: number): Promise<void> {
    const jobId = `first-move:${roomId}`;
    await this.firstMoveQueue.remove(jobId).catch(() => {});
    await this.firstMoveQueue.add(
      "first-move-timeout",
      { roomId },
      {
        jobId,
        delay: delayMs,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  async cancelFirstMoveTimer(roomId: string): Promise<void> {
    await this.firstMoveQueue.remove(`first-move:${roomId}`).catch(() => {});
  }

  isPersistent(): boolean {
    return true;
  }

  async close(): Promise<void> {
    await Promise.all([
      this.clockWorker.close(),
      this.abandonWorker.close(),
      this.firstMoveWorker.close(),
    ]);
    await Promise.all([
      this.clockQueue.close(),
      this.abandonQueue.close(),
      this.firstMoveQueue.close(),
    ]);
    await this.workerConnection.quit();
  }
}

// ─── MatchmakingSweepScheduler ─────────────────────────────────────────

export interface MatchmakingSweepScheduler {
  start(intervalMs: number): void;
  stop(): void;
  close(): Promise<void>;
}

export class InMemoryMatchmakingSweepScheduler implements MatchmakingSweepScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly sweepFn: () => Promise<void>) {}

  start(intervalMs: number): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.sweepFn();
    }, intervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async close(): Promise<void> {
    this.stop();
  }
}

const SWEEP_QUEUE = "tiao-matchmaking-sweep";

export class BullMQMatchmakingSweepScheduler implements MatchmakingSweepScheduler {
  private readonly queue: Queue;
  private readonly worker: Worker;
  private readonly workerConnection: Redis;

  constructor(redis: Redis, sweepFn: () => Promise<void>) {
    this.workerConnection = duplicateForBullMQ(redis);
    this.queue = new Queue(SWEEP_QUEUE, { connection: redis });
    this.worker = new Worker(
      SWEEP_QUEUE,
      async () => {
        await sweepFn();
      },
      { connection: this.workerConnection, concurrency: 1 },
    );
    attachWorkerErrorHandler(this.worker, SWEEP_QUEUE);
  }

  start(intervalMs: number): void {
    // BullMQ repeatable job — only one instance picks up each occurrence
    void this.queue.add(
      "sweep",
      {},
      {
        repeat: { every: intervalMs },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  stop(): void {
    void this.queue.removeRepeatable("sweep", { every: 5_000 });
  }

  async close(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
    await this.workerConnection.quit();
  }
}

// ─── ExportJobScheduler ────────────────────────────────────────────────

export interface ExportJobScheduler {
  enqueue(requestId: string): void;
  close(): Promise<void>;
}

export class InMemoryExportScheduler implements ExportJobScheduler {
  constructor(private readonly runFn: (requestId: string) => Promise<void>) {}

  enqueue(requestId: string): void {
    setImmediate(() => {
      void this.runFn(requestId).catch((err) => {
        console.error("[export] Unhandled worker error:", err);
      });
    });
  }

  async close(): Promise<void> {}
}

const EXPORT_QUEUE = "tiao-data-export";

export class BullMQExportScheduler implements ExportJobScheduler {
  private readonly queue: Queue;
  private readonly worker: Worker;
  private readonly workerConnection: Redis;

  constructor(redis: Redis, runFn: (requestId: string) => Promise<void>) {
    this.workerConnection = duplicateForBullMQ(redis);
    this.queue = new Queue(EXPORT_QUEUE, { connection: redis });
    this.worker = new Worker(
      EXPORT_QUEUE,
      async (job) => {
        const { requestId } = job.data as { requestId: string };
        await runFn(requestId);
      },
      { connection: this.workerConnection, concurrency: 1 },
    );
    attachWorkerErrorHandler(this.worker, EXPORT_QUEUE);
  }

  enqueue(requestId: string): void {
    void this.queue.add(
      "export",
      { requestId },
      {
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  async close(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
    await this.workerConnection.quit();
  }
}
