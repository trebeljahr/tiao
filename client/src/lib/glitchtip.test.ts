import { describe, it, expect, vi, beforeEach } from "vitest";

// The whole point of the 2026-04-16 cold-compile refactor is that
// `@sentry/browser` must NOT enter the module graph when glitchtip is
// disabled. Vitest runs with NODE_ENV=test, which trips the same
// `process.env.NODE_ENV !== "production"` early return, so the test
// verifies the dev-disabled path end-to-end. We still mock
// `@sentry/browser` defensively so a future regression that pulls the
// SDK in synchronously doesn't break the test run on a machine that
// hasn't installed it.
const sentryInit = vi.fn();
const sentryCapture = vi.fn();
const sentrySetUser = vi.fn();
const sentryWithScope = vi.fn((cb: (scope: { setExtras: () => void }) => void) =>
  cb({ setExtras: vi.fn() }),
);

vi.mock("@sentry/browser", () => ({
  init: sentryInit,
  captureException: sentryCapture,
  setUser: sentrySetUser,
  withScope: sentryWithScope,
}));

beforeEach(() => {
  sentryInit.mockClear();
  sentryCapture.mockClear();
  sentrySetUser.mockClear();
  sentryWithScope.mockClear();
});

describe("glitchtip — disabled in dev / test", () => {
  it("glitchtipEnabled is false (no DSN, NODE_ENV !== production)", async () => {
    const { glitchtipEnabled } = await import("./glitchtip");
    expect(glitchtipEnabled).toBe(false);
  });

  it("captureException is a no-op that does not touch @sentry/browser", async () => {
    const { captureException } = await import("./glitchtip");

    // Call it with a realistic error + context shape.
    const err = new Error("boom");
    captureException(err, { digest: "abc123" });

    // Give any accidental dynamic-import .then callbacks a chance to run.
    await Promise.resolve();
    await Promise.resolve();

    expect(sentryCapture).not.toHaveBeenCalled();
    expect(sentryWithScope).not.toHaveBeenCalled();
  });

  it("setUser is a no-op that does not touch @sentry/browser", async () => {
    const { setUser } = await import("./glitchtip");

    setUser({ id: "player-1", username: "rico" });
    await Promise.resolve();
    await Promise.resolve();

    expect(sentrySetUser).not.toHaveBeenCalled();
  });

  it("setUser(null) is also a no-op", async () => {
    const { setUser } = await import("./glitchtip");

    setUser(null);
    await Promise.resolve();
    await Promise.resolve();

    expect(sentrySetUser).not.toHaveBeenCalled();
  });

  it("does NOT call Sentry.init() on module load", async () => {
    // Reimport to exercise the top-level init branch.
    await import("./glitchtip");
    await Promise.resolve();
    await Promise.resolve();

    expect(sentryInit).not.toHaveBeenCalled();
  });
});
