import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { ReactNode } from "react";
import {
  AnalyticsConsentProvider,
  useAnalyticsConsent,
  ANALYTICS_CONSENT_STORAGE_KEY,
} from "./AnalyticsConsent";

// Mock @/lib/openpanel so we don't pull the real SDK and its
// globals into the test environment.  We only care that the
// consent provider calls these wrappers at the right moments —
// the OpenPanel SDK's behavior is not under test here.
vi.mock("@/lib/openpanel", () => ({
  openPanelConfigured: true,
  enableTracking: vi.fn(),
  disableTracking: vi.fn(),
}));

type ElectronAnalyticsStub = {
  setEnabled: ReturnType<typeof vi.fn>;
};
type ElectronStub = {
  isElectron: boolean;
  analytics: ElectronAnalyticsStub;
};

function installElectronStub(isElectron = true): ElectronStub {
  const stub: ElectronStub = {
    isElectron,
    analytics: {
      setEnabled: vi.fn().mockResolvedValue({ ok: true }),
    },
  };
  // Assign to window so the provider's inline type cast picks it up.
  (window as unknown as { electron?: ElectronStub }).electron = stub;
  return stub;
}

function uninstallElectronStub(): void {
  delete (window as unknown as { electron?: ElectronStub }).electron;
}

function wrap({ children }: { children: ReactNode }) {
  return <AnalyticsConsentProvider>{children}</AnalyticsConsentProvider>;
}

describe("AnalyticsConsent — Electron consent bridge", () => {
  beforeEach(() => {
    localStorage.clear();
    uninstallElectronStub();
  });

  afterEach(() => {
    uninstallElectronStub();
  });

  test("grant() mirrors to window.electron.analytics.setEnabled(true)", () => {
    const stub = installElectronStub();
    const { result } = renderHook(() => useAnalyticsConsent(), { wrapper: wrap });

    act(() => {
      result.current.grant();
    });

    expect(stub.analytics.setEnabled).toHaveBeenCalledTimes(1);
    expect(stub.analytics.setEnabled).toHaveBeenCalledWith(true);
    expect(result.current.status).toBe("granted");
  });

  test("revoke() mirrors to window.electron.analytics.setEnabled(false)", () => {
    const stub = installElectronStub();
    const { result } = renderHook(() => useAnalyticsConsent(), { wrapper: wrap });

    act(() => {
      result.current.revoke();
    });

    expect(stub.analytics.setEnabled).toHaveBeenCalledTimes(1);
    expect(stub.analytics.setEnabled).toHaveBeenCalledWith(false);
    expect(result.current.status).toBe("denied");
  });

  test("hydration with persisted 'granted' mirrors enabled=true once", () => {
    localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, "granted");
    const stub = installElectronStub();

    const { result } = renderHook(() => useAnalyticsConsent(), { wrapper: wrap });

    expect(stub.analytics.setEnabled).toHaveBeenCalledTimes(1);
    expect(stub.analytics.setEnabled).toHaveBeenCalledWith(true);
    expect(result.current.status).toBe("granted");
  });

  test("hydration with persisted 'denied' mirrors enabled=false once", () => {
    localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, "denied");
    const stub = installElectronStub();

    const { result } = renderHook(() => useAnalyticsConsent(), { wrapper: wrap });

    expect(stub.analytics.setEnabled).toHaveBeenCalledTimes(1);
    expect(stub.analytics.setEnabled).toHaveBeenCalledWith(false);
    expect(result.current.status).toBe("denied");
  });

  test("hydration with 'pending' (no stored consent) does NOT touch Electron", () => {
    // Nothing in localStorage ⇒ status starts as "pending".  The main
    // process default (off) must stay as-is until the user actively
    // decides — we don't want to accidentally opt them in OR confirm a
    // rejection they never made.
    const stub = installElectronStub();

    renderHook(() => useAnalyticsConsent(), { wrapper: wrap });

    expect(stub.analytics.setEnabled).not.toHaveBeenCalled();
  });

  test("is a no-op when window.electron is absent (web runtime)", () => {
    // Web clients have no preload bridge.  The helper must short-circuit
    // silently rather than throw on the missing `.electron` or
    // `.analytics.setEnabled` accesses.
    expect((window as { electron?: unknown }).electron).toBeUndefined();
    const { result } = renderHook(() => useAnalyticsConsent(), { wrapper: wrap });

    expect(() => {
      act(() => result.current.grant());
      act(() => result.current.revoke());
    }).not.toThrow();
  });

  test("is a no-op when electron.isElectron is false (preload stub without flag)", () => {
    const stub = installElectronStub(false);
    const { result } = renderHook(() => useAnalyticsConsent(), { wrapper: wrap });

    act(() => result.current.grant());

    expect(stub.analytics.setEnabled).not.toHaveBeenCalled();
  });

  test("swallows IPC rejection without breaking the grant flow", async () => {
    const stub = installElectronStub();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    stub.analytics.setEnabled.mockRejectedValueOnce(new Error("IPC dead"));

    const { result } = renderHook(() => useAnalyticsConsent(), { wrapper: wrap });

    act(() => {
      result.current.grant();
    });

    // Give the .catch microtask a turn.
    await Promise.resolve();
    await Promise.resolve();

    expect(result.current.status).toBe("granted");
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
