/**
 * Process-level crash guard.
 *
 * Installs `unhandledRejection` and `uncaughtException` listeners so that a
 * single throw in an async handler — a malformed BullMQ jobId, a dropped
 * Mongo connection inside a fire-and-forget broadcast, a WebSocket `send`
 * after `close`, etc. — doesn't bring down the whole Node process and kick
 * every connected player off their game.
 *
 * This is a last-resort net. Individual call sites should still handle
 * their own errors locally where possible; we just don't want the fallback
 * to be "crash the entire server for every in-flight player".
 *
 * Interaction with GlitchTip/Sentry:
 * - `@sentry/node`'s `OnUncaughtException` integration defaults to
 *   `exitEvenIfOtherHandlersAreRegistered: false` — if another listener is
 *   attached (this one), Sentry captures but does NOT call `process.exit()`.
 * - `OnUnhandledRejection` defaults to `mode: 'warn'` — it captures and
 *   warns but never exits.
 * - Net result: in production, errors go to GlitchTip AND we keep running.
 *   In development (no Sentry init), this is the only listener, and Node
 *   would otherwise print-and-exit — so this guard is what keeps nodemon
 *   from crash-looping on every dev-time mistake.
 *
 * Why we don't exit on `uncaughtException`:
 * Node's docs say the process is in an undefined state after an uncaught
 * exception and should exit. In theory that's true. In practice, for a
 * long-running game server where one bad handler in one request shouldn't
 * disconnect hundreds of other players mid-game, logging and continuing is
 * the right trade-off. If we ever see real evidence of state corruption
 * (memory leaks, stuck state, etc.) we can revisit with a graceful
 * drain-and-restart strategy.
 */

import { captureException } from "./glitchtip";

let installed = false;
let rejectionListener: NodeJS.UnhandledRejectionListener | null = null;
let exceptionListener: NodeJS.UncaughtExceptionListener | null = null;

export function installCrashGuard(): void {
  if (installed) return;
  installed = true;

  rejectionListener = (reason: unknown) => {
    console.error("[crashGuard] unhandledRejection:", reason);
    try {
      captureException(reason, { kind: "unhandledRejection" });
    } catch {
      /* swallow — we must not throw from the crash guard itself */
    }
  };

  exceptionListener = (err: Error) => {
    console.error("[crashGuard] uncaughtException:", err);
    try {
      captureException(err, { kind: "uncaughtException" });
    } catch {
      /* swallow — we must not throw from the crash guard itself */
    }
    // Deliberately do NOT exit. See file header.
  };

  process.on("unhandledRejection", rejectionListener);
  process.on("uncaughtException", exceptionListener);
}

/**
 * Test-only helper: uninstall the listeners and reset the `installed` flag
 * so a subsequent installCrashGuard() call actually re-registers. Do not
 * call this from production code.
 */
export function __resetCrashGuardForTests(): void {
  if (rejectionListener) {
    process.off("unhandledRejection", rejectionListener);
    rejectionListener = null;
  }
  if (exceptionListener) {
    process.off("uncaughtException", exceptionListener);
    exceptionListener = null;
  }
  installed = false;
}
