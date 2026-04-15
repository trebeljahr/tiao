import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Guards the `/collect` proxy bypass that keeps OpenPanel from
 * POSTing to `app://tiao/collect/track` in the desktop Electron
 * build.
 *
 * The proxy lives in `client/server.mjs` and only exists for the
 * web build. The desktop static export has no Node server in front,
 * so a relative `/collect` URL resolves against the document origin
 * (`app://tiao/`) and 404s forever. The fix in `openpanel.ts` is to
 * route through `directApiUrl` (the real OpenPanel ingest host)
 * whenever `NEXT_PUBLIC_PLATFORM === "desktop"`, regardless of
 * NODE_ENV.
 *
 * openpanel.ts reads both env vars at module load, so each test
 * needs `vi.resetModules()` + `vi.stubEnv()` + a dynamic import to
 * get a fresh instance observing the stubbed environment. We can't
 * inspect the internal `apiUrl` variable directly (it's private),
 * so we assert on the shape of the real `OpenPanel` constructor
 * call via a spy.
 */

const constructorSpy = vi.fn();

vi.mock("@openpanel/web", () => {
  return {
    OpenPanel: class MockOpenPanel {
      options: Record<string, unknown>;
      constructor(opts: Record<string, unknown>) {
        constructorSpy(opts);
        this.options = opts;
      }
      clear() {}
      setGlobalProperties() {}
    },
  };
});

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

  async function loadModule() {
    return await import("./openpanel");
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
    await loadModule();
    expect(constructorSpy).toHaveBeenCalled();
    expect(lastApiUrl()).toBe("/collect");
  });

  it("desktop production build bypasses /collect and hits the ingest host directly", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_PLATFORM", "desktop");
    await loadModule();
    expect(constructorSpy).toHaveBeenCalled();
    // Crucially: NOT "/collect", which would resolve to
    // `app://tiao/collect/track` in the renderer.
    expect(lastApiUrl()).not.toBe("/collect");
    expect(lastApiUrl()).toBe("https://op.example.test");
  });

  it("dev builds bypass /collect regardless of platform (no server in front)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_PLATFORM", "");
    await loadModule();
    expect(constructorSpy).toHaveBeenCalled();
    expect(lastApiUrl()).toBe("https://op.example.test");
  });
});
