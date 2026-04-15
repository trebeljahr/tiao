import assert from "node:assert/strict";
import { describe, test, beforeEach, afterEach } from "node:test";
import { installCrashGuard, __resetCrashGuardForTests } from "../lib/crashGuard";

describe("crashGuard", () => {
  let originalExit: typeof process.exit;
  let exitCalled = false;
  let consoleErrors: unknown[][];
  let originalConsoleError: typeof console.error;
  let savedRejectionListeners: NodeJS.UnhandledRejectionListener[];
  let savedExceptionListeners: NodeJS.UncaughtExceptionListener[];

  beforeEach(() => {
    // Snapshot other listeners (e.g. the test runner's own) so we can
    // restore them in afterEach. We remove them during the test so the
    // crash guard is the only listener and `process.emit(...)` deterministic-
    // ally exercises only our handler.
    savedRejectionListeners = process
      .listeners("unhandledRejection")
      .filter((l) => l.name !== "rejectionListener");
    savedExceptionListeners = process
      .listeners("uncaughtException")
      .filter((l) => l.name !== "exceptionListener");
    for (const l of savedRejectionListeners) process.off("unhandledRejection", l);
    for (const l of savedExceptionListeners) process.off("uncaughtException", l);

    // Uninstall and reinstall so the module-level `installed` guard doesn't
    // block the next registration after removeAllListeners.
    __resetCrashGuardForTests();

    exitCalled = false;
    originalExit = process.exit;
    process.exit = ((code?: number) => {
      exitCalled = true;
      throw new Error(`process.exit(${code}) called`);
    }) as typeof process.exit;

    consoleErrors = [];
    originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      consoleErrors.push(args);
    };

    installCrashGuard();
  });

  afterEach(() => {
    __resetCrashGuardForTests();
    process.exit = originalExit;
    console.error = originalConsoleError;
    for (const l of savedRejectionListeners) process.on("unhandledRejection", l);
    for (const l of savedExceptionListeners) process.on("uncaughtException", l);
  });

  test("unhandledRejection is logged and does not exit", async () => {
    // Simulate what Node does when a promise rejection goes unhandled:
    // emit the event directly. We don't want to actually trigger a real
    // unhandled rejection because the node:test runner treats those as
    // test failures independent of our listeners.
    const err = new Error("simulated unhandled rejection");
    process.emit(
      "unhandledRejection",
      err,
      Promise.reject(err).catch(() => {}),
    );

    // Swallow the still-pending rejected promise so the test runner doesn't
    // flag it. (We created it as reason context; it's not the test subject.)
    await new Promise((r) => setImmediate(r));

    assert.equal(exitCalled, false, "crash guard must not call process.exit");
    assert.ok(
      consoleErrors.some(
        (line) =>
          line[0] === "[crashGuard] unhandledRejection:" &&
          (line[1] as Error).message === "simulated unhandled rejection",
      ),
      `expected crashGuard log line; saw: ${JSON.stringify(consoleErrors)}`,
    );
  });

  test("uncaughtException is logged and does not exit", () => {
    const err = new Error("simulated uncaught exception");
    process.emit("uncaughtException", err);

    assert.equal(exitCalled, false, "crash guard must not call process.exit");
    assert.ok(
      consoleErrors.some(
        (line) =>
          line[0] === "[crashGuard] uncaughtException:" &&
          (line[1] as Error).message === "simulated uncaught exception",
      ),
      `expected crashGuard log line; saw: ${JSON.stringify(consoleErrors)}`,
    );
  });

  test("installCrashGuard is idempotent — calling twice does not double-log", () => {
    // Second install should be a no-op (guarded by `installed` flag)
    installCrashGuard();
    installCrashGuard();

    const err = new Error("idempotency probe");
    process.emit("uncaughtException", err);

    // Exactly one log line, not three
    const matchingLines = consoleErrors.filter(
      (line) => line[0] === "[crashGuard] uncaughtException:",
    );
    assert.equal(matchingLines.length, 1, "handler should fire exactly once");
  });
});
