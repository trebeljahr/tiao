import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type BeforeInstallPromptEvent, usePwaInstall } from "./usePwaInstall";

/**
 * Builds a minimal BeforeInstallPromptEvent stand-in whose `userChoice`
 * promise resolves to the caller-supplied outcome. We can't construct the
 * real event in jsdom (it doesn't exist there), so this is the smallest
 * shape the hook needs.
 */
function makeBeforeInstallPromptEvent(outcome: "accepted" | "dismissed"): BeforeInstallPromptEvent {
  const event = new Event("beforeinstallprompt") as BeforeInstallPromptEvent;
  Object.defineProperty(event, "platforms", { value: ["web"] });
  Object.defineProperty(event, "prompt", {
    value: vi.fn().mockResolvedValue(undefined),
  });
  Object.defineProperty(event, "userChoice", {
    value: Promise.resolve({ outcome, platform: "web" }),
  });
  return event;
}

describe("usePwaInstall", () => {
  const matchMediaSpy = vi.fn<typeof window.matchMedia>();

  beforeEach(() => {
    vi.stubGlobal("matchMedia", matchMediaSpy);
    window.localStorage.clear();
    matchMediaSpy.mockImplementation(
      (query: string) =>
        ({
          matches: false,
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => true,
        }) as MediaQueryList,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("starts with canInstall = false when no install event has fired", () => {
    const { result } = renderHook(() => usePwaInstall());
    expect(result.current.canInstall).toBe(false);
    expect(result.current.isStandalone).toBe(false);
  });

  it("flips canInstall = true after beforeinstallprompt fires", () => {
    const { result } = renderHook(() => usePwaInstall());

    act(() => {
      window.dispatchEvent(makeBeforeInstallPromptEvent("accepted"));
    });

    expect(result.current.canInstall).toBe(true);
  });

  it("reports standalone when the display-mode media query matches", () => {
    matchMediaSpy.mockImplementation(
      (query: string) =>
        ({
          matches: query === "(display-mode: standalone)",
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => true,
        }) as MediaQueryList,
    );

    const { result } = renderHook(() => usePwaInstall());
    expect(result.current.isStandalone).toBe(true);

    // No install entry when already installed.
    act(() => {
      window.dispatchEvent(makeBeforeInstallPromptEvent("accepted"));
    });
    expect(result.current.canInstall).toBe(false);
  });

  it("promptInstall() returns 'unavailable' before beforeinstallprompt fires", async () => {
    const { result } = renderHook(() => usePwaInstall());
    const outcome = await result.current.promptInstall();
    expect(outcome).toBe("unavailable");
  });

  it("promptInstall() returns the user's choice and clears canInstall on accept", async () => {
    const { result } = renderHook(() => usePwaInstall());

    act(() => {
      window.dispatchEvent(makeBeforeInstallPromptEvent("accepted"));
    });

    let outcome: Awaited<ReturnType<typeof result.current.promptInstall>> | undefined;
    await act(async () => {
      outcome = await result.current.promptInstall();
    });

    expect(outcome).toBe("accepted");
    expect(result.current.canInstall).toBe(false);
  });

  it("promptInstall() returns 'dismissed' and stores nothing when the user declines", async () => {
    const { result } = renderHook(() => usePwaInstall());

    act(() => {
      window.dispatchEvent(makeBeforeInstallPromptEvent("dismissed"));
    });

    let outcome: Awaited<ReturnType<typeof result.current.promptInstall>> | undefined;
    await act(async () => {
      outcome = await result.current.promptInstall();
    });

    expect(outcome).toBe("dismissed");
    expect(window.localStorage.length).toBe(0);
  });

  it("canInstall is false when the app is already standalone", () => {
    matchMediaSpy.mockImplementation(
      (query: string) =>
        ({
          matches: query === "(display-mode: standalone)",
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => true,
        }) as MediaQueryList,
    );

    const { result } = renderHook(() => usePwaInstall());

    act(() => {
      window.dispatchEvent(makeBeforeInstallPromptEvent("accepted"));
    });
    expect(result.current.canInstall).toBe(false);
  });

  it("appinstalled event marks the app as standalone and hides the install entry", () => {
    const { result } = renderHook(() => usePwaInstall());

    act(() => {
      window.dispatchEvent(makeBeforeInstallPromptEvent("accepted"));
    });
    expect(result.current.canInstall).toBe(true);

    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });

    expect(result.current.canInstall).toBe(false);
    expect(result.current.isStandalone).toBe(true);
  });
});
