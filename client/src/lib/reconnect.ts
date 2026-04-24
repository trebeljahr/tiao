export type ReconnectOptions = {
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterMs?: number;
};

const DEFAULTS: Required<ReconnectOptions> = {
  baseDelayMs: 1500,
  maxDelayMs: 10000,
  jitterMs: 1000,
};

export function createReconnectScheduler(onReconnect: () => void, options: ReconnectOptions = {}) {
  const config = { ...DEFAULTS, ...options };
  let attempt = 0;
  let timer: number | null = null;
  let stableTimer: number | null = null;

  function schedule() {
    clear();
    const baseDelay = Math.min(config.baseDelayMs * 2 ** Math.min(attempt, 3), config.maxDelayMs);
    const delay = baseDelay + Math.random() * config.jitterMs;
    attempt += 1;
    timer = window.setTimeout(onReconnect, delay);
  }

  /** Mark the connection as stable after a short grace period. */
  function reset() {
    if (stableTimer !== null) window.clearTimeout(stableTimer);
    stableTimer = window.setTimeout(() => {
      attempt = 0;
      stableTimer = null;
    }, 3000);
  }

  function clear() {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    if (stableTimer !== null) {
      window.clearTimeout(stableTimer);
      stableTimer = null;
    }
  }

  function getAttempt() {
    return attempt;
  }

  return { schedule, reset, clear, getAttempt };
}
