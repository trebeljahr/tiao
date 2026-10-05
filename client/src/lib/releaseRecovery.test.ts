import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isStaleReleaseError,
  isStaleReleaseResource,
  RELEASE_RECOVERY_INLINE_SCRIPT,
  recoverFromStaleRelease,
} from "./releaseRecovery";

describe("release recovery", () => {
  const reload = vi.fn();
  beforeEach(() => {
    window.sessionStorage.clear();
    reload.mockReset();
    vi.stubGlobal("location", { ...window.location, reload });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("recognises chunk and dynamic import failures only", () => {
    expect(isStaleReleaseError({ name: "ChunkLoadError", message: "x" })).toBe(true);
    expect(isStaleReleaseError(new Error("Loading chunk 123 failed."))).toBe(true);
    expect(
      isStaleReleaseError(new TypeError("Failed to fetch dynamically imported module: /x.js")),
    ).toBe(true);
    expect(isStaleReleaseError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isStaleReleaseError(undefined)).toBe(false);
  });

  it("reloads once, then the loop guard holds for 30 seconds", () => {
    vi.useFakeTimers();
    expect(recoverFromStaleRelease({ name: "ChunkLoadError" })).toBe(true);
    expect(recoverFromStaleRelease({ name: "ChunkLoadError" })).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 31_000);
    expect(recoverFromStaleRelease({ name: "ChunkLoadError" })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("never reloads for unrelated errors", () => {
    expect(recoverFromStaleRelease(new Error("boom"))).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("treats failed release scripts and stylesheets as stale, not other elements", () => {
    const script = document.createElement("script");
    script.src = "https://playtiao.com/_next/static/chunks/abc.js";
    const image = document.createElement("img");
    image.src = "https://playtiao.com/_next/static/media/a.png";
    expect(isStaleReleaseResource(script)).toBe(true);
    expect(isStaleReleaseResource(image)).toBe(false);
    expect(isStaleReleaseResource(null)).toBe(false);
  });

  it("inline guard reloads on load when a release stylesheet failed before it ran", () => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://playtiao.com/_next/static/css/missing.css";
    document.head.appendChild(link);
    try {
      // biome-ignore lint/security/noGlobalEval: executes the exact inline script under test
      window.eval(RELEASE_RECOVERY_INLINE_SCRIPT);
      window.dispatchEvent(new Event("load"));
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      link.remove();
    }
  });
});
