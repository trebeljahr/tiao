import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePwaInstall, type BeforeInstallPromptEvent } from "./usePwaInstall";

const DISMISS_STORAGE_KEY = "tiao:pwa-install-dismissed";

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
  const matchMediaSpy = vi.spyOn(window, "matchMedia");

  beforeEach(() => {
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
    vi.clearAllMocks();
  });

  it("starts with canPrompt = false when no install event has fired", () => {
    const { result } = renderHook(() => usePwaInstall());
    expect(result.current.canPrompt).toBe(false);
    expect(result.current.isStandalone).toBe(false);
  });

  it("flips canPrompt = true after beforeinstallprompt fires", () => {
    const { result } = renderHook(() => usePwaInstall());

    act(() => {
      window.dispatchEvent(makeBeforeInstallPromptEvent("accepted"));
    });

    expect(result.current.canPrompt).toBe(true);
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

    // Banner should not prompt when already installed.
    act(() => {
      window.dispatchEvent(makeBeforeInstallPromptEvent("accepted"));
    });
    expect(result.current.canPrompt).toBe(false);
  });

  it("does not prompt when cooldown is active from a previous dismissal", () => {
    window.localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now()));

    const { result } = renderHook(() => usePwaInstall());

    act(() => {
      window.dispatchEvent(makeBeforeInstallPromptEvent("accepted"));
    });

    expect(result.current.canPrompt).toBe(false);
  });

  it("allows prompting again after the cooldown window expires", () => {
    const fifteenDaysAgo = Date.now() - 1000 * 60 * 60 * 24 * 15;
    window.localStorage.setItem(DISMISS_STORAGE_KEY, String(fifteenDaysAgo));

    const { result } = renderHook(() => usePwaInstall());

    act(() => {
      window.dispatchEvent(makeBeforeInstallPromptEvent("accepted"));
    });

    expect(result.current.canPrompt).toBe(true);
  });

  it("dismiss() records a cooldown and hides the banner", () => {
    const { result } = renderHook(() => usePwaInstall());

    act(() => {
      window.dispatchEvent(makeBeforeInstallPromptEvent("accepted"));
    });
    expect(result.current.canPrompt).toBe(true);

    act(() => {
      result.current.dismiss();
    });

    expect(result.current.canPrompt).toBe(false);
    expect(window.localStorage.getItem(DISMISS_STORAGE_KEY)).not.toBeNull();
  });

  it("promptInstall() returns 'unavailable' before beforeinstallprompt fires", async () => {
    const { result } = renderHook(() => usePwaInstall());
    const outcome = await result.current.promptInstall();
    expect(outcome).toBe("unavailable");
  });

  it("promptInstall() returns the user's choice and clears canPrompt on accept", async () => {
    const { result } = renderHook(() => usePwaInstall());

    act(() => {
      window.dispatchEvent(makeBeforeInstallPromptEvent("accepted"));
    });

    let outcome: Awaited<ReturnType<typeof result.current.promptInstall>> | undefined;
    await act(async () => {
      outcome = await result.current.promptInstall();
    });

    expect(outcome).toBe("accepted");
    expect(result.current.canPrompt).toBe(false);
    // Accepted installs do not set a dismissal cooldown.
    expect(window.localStorage.getItem(DISMISS_STORAGE_KEY)).toBeNull();
  });

  it("promptInstall() records dismissal cooldown when user declines the native prompt", async () => {
    const { result } = renderHook(() => usePwaInstall());

    act(() => {
      window.dispatchEvent(makeBeforeInstallPromptEvent("dismissed"));
    });

    let outcome: Awaited<ReturnType<typeof result.current.promptInstall>> | undefined;
    await act(async () => {
      outcome = await result.current.promptInstall();
    });

    expect(outcome).toBe("dismissed");
    expect(window.localStorage.getItem(DISMISS_STORAGE_KEY)).not.toBeNull();
  });

  it("appinstalled event marks the app as standalone and hides the banner", () => {
    const { result } = renderHook(() => usePwaInstall());

    act(() => {
      window.dispatchEvent(makeBeforeInstallPromptEvent("accepted"));
    });
    expect(result.current.canPrompt).toBe(true);

    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });

    expect(result.current.canPrompt).toBe(false);
    expect(result.current.isStandalone).toBe(true);
  });
});
