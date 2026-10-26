import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("glitchtip — production lazy SDK", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_GLITCHTIP_DSN", "https://public@example.test/1");
    vi.stubEnv("NEXT_PUBLIC_PLATFORM", "web");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("initializes once before queued reports and user updates", async () => {
    const { captureException, setUser, glitchtipEnabled } = await import("./glitchtip");
    expect(glitchtipEnabled).toBe(true);
    const error = new Error("production report");
    const user = { id: "player-1", username: "rico" };
    captureException(error, { digest: "abc123" });
    setUser(user);
    setUser(null);

    await vi.waitFor(() => expect(sentryCapture).toHaveBeenCalledWith(error));
    expect(sentryInit).toHaveBeenCalledTimes(1);
    expect(sentryInit).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: "https://public@example.test/1",
        tunnel: "/api/_e",
      }),
    );
    expect(sentryWithScope).toHaveBeenCalledTimes(1);
    expect(sentrySetUser.mock.calls).toEqual([[user], [null]]);
    expect(sentryInit.mock.invocationCallOrder[0]).toBeLessThan(
      sentryCapture.mock.invocationCallOrder[0],
    );
  });

  it.each(["desktop", "no DSN"])("keeps reporting disabled for %s", async (mode) => {
    if (mode === "desktop") vi.stubEnv("NEXT_PUBLIC_PLATFORM", "desktop");
    else vi.stubEnv("NEXT_PUBLIC_GLITCHTIP_DSN", "");
    const { captureException, setUser, glitchtipEnabled } = await import("./glitchtip");
    expect(glitchtipEnabled).toBe(false);
    captureException(new Error("ignored"));
    setUser({ id: "player-1" });
    await Promise.resolve();
    expect(sentryInit).not.toHaveBeenCalled();
    expect(sentryCapture).not.toHaveBeenCalled();
    expect(sentrySetUser).not.toHaveBeenCalled();
  });
});
