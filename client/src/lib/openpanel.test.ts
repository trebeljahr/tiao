import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Shared mock ────────────────────────────────────────────────────
//
// Two test suites share this mock:
//   1. "disabled in dev / test" — verifies the 2026-04-16 cold-compile
//      refactor's no-op path (SDK never loaded, constructor never called).
//   2. "API URL resolution" — verifies the desktop `/collect` proxy
//      bypass (SDK IS loaded in simulated production, constructor
//      receives the expected apiUrl).
//
// The mock must satisfy both: a constructor spy for the URL tests AND
// method stubs for the lazy-load no-op tests.

const constructorSpy = vi.fn();
const openPanelTrack = vi.fn();
const openPanelIdentify = vi.fn();
const openPanelClear = vi.fn();
const openPanelSetGlobalProperties = vi.fn();

vi.mock("@openpanel/web", () => ({
  OpenPanel: vi.fn().mockImplementation((opts: Record<string, unknown>) => {
    constructorSpy(opts);
    return {
      track: openPanelTrack,
      identify: openPanelIdentify,
      clear: openPanelClear,
      setGlobalProperties: openPanelSetGlobalProperties,
      options: { disabled: false },
    };
  }),
}));

beforeEach(() => {
  constructorSpy.mockClear();
  openPanelTrack.mockClear();
  openPanelIdentify.mockClear();
  openPanelClear.mockClear();
  openPanelSetGlobalProperties.mockClear();
});

// ─── Suite 1: dev / test no-op path ──────────────────────────────────
//
// The whole point of the cold-compile refactor is that `@openpanel/web`
// must NOT enter the module graph when OpenPanel is disabled. Vitest
// runs with NODE_ENV=test, which trips the same
// `process.env.NODE_ENV !== "production"` gate in `getOpenPanel()`, so
// these tests verify the dev-disabled path end-to-end.

describe("openpanel — disabled in dev / test", () => {
  it("openPanelConfigured is false when env vars are unset", async () => {
    const { openPanelConfigured } = await import("./openpanel");
    expect(openPanelConfigured).toBe(false);
  });

  it("op.track() is callable and does not touch @openpanel/web", async () => {
    const { op } = await import("./openpanel");

    expect(() => op.track("something_happened", { foo: "bar" })).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(constructorSpy).not.toHaveBeenCalled();
    expect(openPanelTrack).not.toHaveBeenCalled();
  });

  it("op.identify() is callable and does not touch @openpanel/web", async () => {
    const { op } = await import("./openpanel");

    expect(() => op.identify({ profileId: "player-1" })).not.toThrow();
    await Promise.resolve();

    expect(openPanelIdentify).not.toHaveBeenCalled();
  });

  it("op.clear() is callable and does not touch @openpanel/web", async () => {
    const { op } = await import("./openpanel");

    expect(() => op.clear()).not.toThrow();
    await Promise.resolve();

    expect(openPanelClear).not.toHaveBeenCalled();
  });

  it("op proxy returns undefined for the thenable `then` access", async () => {
    const { op } = await import("./openpanel");

    // The Proxy must opt out of Promise unwrapping so code that does
    // `await import("./openpanel")` doesn't treat `op` as a thenable.
    const proxyThen = (op as unknown as { then?: unknown }).then;
    expect(proxyThen).toBeUndefined();
  });

  it("enableTracking() is a no-op when not configured (does not construct SDK)", async () => {
    const { enableTracking } = await import("./openpanel");

    enableTracking();
    await Promise.resolve();
    await Promise.resolve();

    expect(constructorSpy).not.toHaveBeenCalled();
  });

  it("setAuthReady(true) is a no-op when not configured", async () => {
    const { setAuthReady } = await import("./openpanel");

    setAuthReady(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(constructorSpy).not.toHaveBeenCalled();
  });

  it("disableTracking() is callable even when not configured", async () => {
    const { disableTracking } = await import("./openpanel");

    expect(() => disableTracking()).not.toThrow();
  });
});

// ─── Suite 2: API URL resolution (desktop /collect proxy bypass) ─────
//
// Guards the `/collect` proxy bypass that keeps OpenPanel from POSTing
// to `app://tiao/collect/track` in the desktop Electron build. The
// proxy lives in `client/server.mjs` and only exists for the web build.
//
// Since the 2026-04-16 cold-compile refactor, the SDK is lazy-loaded
// via `getOpenPanel()` and only instantiated inside `maybeEnable()`
// when both consent + auth gates pass. These tests simulate that flow
// by calling `enableTracking()` + `setAuthReady(true)` after import,
// then asserting on the constructor spy's `apiUrl` argument.

describe("openpanel API URL resolution", () => {
  beforeEach(() => {
    constructorSpy.mockClear();
    vi.resetModules();
    // Ensure the module always sees the test's stubbed env values.
    vi.stubEnv("NEXT_PUBLIC_OPENPANEL_CLIENT_ID", "test-client");
    vi.stubEnv("NEXT_PUBLIC_OPENPANEL_API_URL", "https://op.example.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** Load a fresh openpanel module and trigger the full enable flow. */
  async function loadAndEnable() {
    const mod = await import("./openpanel");
    // Trigger the lazy-load: consent + auth must both be granted
    // for maybeEnable → getOpenPanel → import("@openpanel/web") to fire.
    mod.enableTracking();
    mod.setAuthReady(true);
    // Give the async maybeEnable promise a chance to resolve.
    await new Promise((r) => setTimeout(r, 50));
    return mod;
  }

  /** Returns the `apiUrl` passed to the most recent OpenPanel construction. */
  function lastApiUrl(): string {
    const calls = constructorSpy.mock.calls;
    const last = calls[calls.length - 1]?.[0] as { apiUrl: string } | undefined;
    if (!last) throw new Error("OpenPanel constructor was not called");
    return last.apiUrl;
  }

  it("web production build routes through the /collect proxy", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_PLATFORM", "");
    await loadAndEnable();
    expect(constructorSpy).toHaveBeenCalled();
    expect(lastApiUrl()).toBe("/collect");
  });

  it("desktop production build bypasses /collect and hits the ingest host directly", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_PLATFORM", "desktop");
    await loadAndEnable();
    expect(constructorSpy).toHaveBeenCalled();
    // Crucially: NOT "/collect", which would resolve to
    // `app://tiao/collect/track` in the renderer.
    expect(lastApiUrl()).not.toBe("/collect");
    expect(lastApiUrl()).toBe("https://op.example.test");
  });

  it("dev builds do not construct OpenPanel regardless of platform", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_PLATFORM", "");
    await loadAndEnable();
    // getOpenPanel() returns null in dev → constructor never called.
    expect(constructorSpy).not.toHaveBeenCalled();
  });
});
