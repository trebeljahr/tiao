import { describe, test, expect, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOnlineStatus } from "./useOnlineStatus";
import { API_BASE_URL } from "@/lib/api";

describe("useOnlineStatus", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    // Reset navigator.onLine to the default assumed online state
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });

  test("returns navigator.onLine on initial render", () => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);
  });

  test("returns false when navigator.onLine is false on first render", () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(false);
  });

  test("flips to offline when the offline event fires", () => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current).toBe(false);
  });

  test("flips back to online when the online event fires", () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(false);

    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current).toBe(true);
  });

  test("cleans up event listeners on unmount", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useOnlineStatus());
    unmount();
    const calls = removeSpy.mock.calls.map((c) => c[0]);
    expect(calls).toContain("online");
    expect(calls).toContain("offline");
  });

  test("health poll uses API_BASE_URL so the desktop build doesn't hit app://tiao/api/health", async () => {
    // The desktop Electron build's document origin is `app://tiao/`,
    // so a bare `fetch("/api/health")` would resolve against the
    // protocol handler — which doesn't serve it — and 404 every
    // 30 seconds. The fix is to build the URL off `API_BASE_URL`.
    // In the web test environment API_BASE_URL is `window.location.origin`,
    // a non-empty http://... URL, so we can assert the fetch received
    // the absolute form here without needing to stub Electron.
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
    } as unknown as Response);

    const { unmount } = renderHook(() => useOnlineStatus());

    // Fire the first interval tick. The hook uses setInterval with a
    // 30s cadence; advancing past that triggers the first poll.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_001);
    });

    expect(fetchSpy).toHaveBeenCalled();
    const calls = fetchSpy.mock.calls;
    const url = calls[calls.length - 1]?.[0] as string;
    expect(url).toBe(`${API_BASE_URL}/api/health`);
    // Defence-in-depth: the bare "/api/health" form is what caused
    // the desktop 404 spam — assert the fetch argument is NOT that
    // literal string so a regression fails fast regardless of what
    // API_BASE_URL resolves to in the test env.
    expect(url).not.toBe("/api/health");

    unmount();
  });
});
