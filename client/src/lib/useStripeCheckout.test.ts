import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, getCheckoutStatus } from "./api";
import { __resetSafeLocalStorageCacheForTests } from "./safeLocalStorage";
import { isCheckoutSessionId, useStripeCheckout } from "./useStripeCheckout";

vi.mock("./api", () => ({
  getCheckoutStatus: vi.fn(),
  ApiError: class extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
const result = { status: "granted" as const, itemType: "badge" as const, itemId: "supporter" };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  __resetSafeLocalStorageCacheForTests();
  vi.mocked(getCheckoutStatus).mockResolvedValue({ ...result, status: "pending" });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Stripe checkout reconciliation", () => {
  it("keeps slow webhook/payment processing pending beyond six seconds", async () => {
    const settled = vi.fn();
    const { result: hook, unmount } = renderHook(() =>
      useStripeCheckout("alice", "cs_test_123", settled),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(hook.current.checkoutPending).toBe(true);
    expect(settled).not.toHaveBeenCalled();
    expect(localStorage.getItem("tiao:stripe-checkout:alice")).toBe("cs_test_123");
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resumes after restart and only celebrates confirmed fulfillment", async () => {
    localStorage.setItem("tiao:stripe-checkout:alice", "cs_test_saved");
    vi.mocked(getCheckoutStatus).mockResolvedValue(result);
    const settled = vi.fn();
    const { result: hook, unmount } = renderHook(() => useStripeCheckout("alice", null, settled));
    await act(async () => {});
    expect(getCheckoutStatus).toHaveBeenCalledWith("cs_test_saved");
    expect(settled).toHaveBeenCalledExactlyOnceWith(result);
    expect(hook.current.checkoutPending).toBe(false);
    expect(localStorage.getItem("tiao:stripe-checkout:alice")).toBeNull();
    unmount();
  });

  it("preserves a hint during network failure and retries immediately on focus", async () => {
    vi.mocked(getCheckoutStatus).mockRejectedValue(new Error("offline"));
    const settled = vi.fn();
    const { unmount } = renderHook(() => useStripeCheckout("alice", "cs_test_retry", settled));
    await act(async () => {});
    expect(settled).not.toHaveBeenCalled();
    vi.mocked(getCheckoutStatus).mockResolvedValue(result);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(settled).toHaveBeenCalledExactlyOnceWith(result);
    unmount();
  });

  it("waits for auth and never consumes another account's saved checkout", async () => {
    localStorage.setItem("tiao:stripe-checkout:alice", "cs_test_alice");
    const { rerender, unmount } = renderHook(
      ({ player }) => useStripeCheckout(player, null, vi.fn()),
      { initialProps: { player: null as string | null } },
    );
    await act(async () => {});
    expect(getCheckoutStatus).not.toHaveBeenCalled();
    rerender({ player: "bob" });
    await act(async () => {});
    expect(getCheckoutStatus).not.toHaveBeenCalled();
    expect(localStorage.getItem("tiao:stripe-checkout:alice")).toBe("cs_test_alice");
    unmount();
  });

  it("ignores an in-flight response after account changes or unmount", async () => {
    let complete!: (value: typeof result) => void;
    vi.mocked(getCheckoutStatus).mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const settled = vi.fn();
    const { unmount } = renderHook(() => useStripeCheckout("alice", "cs_test_123", settled));
    unmount();
    await act(async () => {
      complete(result);
    });
    expect(settled).not.toHaveBeenCalled();
    expect(localStorage.getItem("tiao:stripe-checkout:alice")).toBe("cs_test_123");
  });

  it("tracks a checkout before leaving for an external browser and clears terminal failure", async () => {
    vi.mocked(getCheckoutStatus).mockResolvedValue({ ...result, status: "failed" });
    const settled = vi.fn();
    const { result: hook, unmount } = renderHook(() => useStripeCheckout("alice", null, settled));
    await act(async () => {
      hook.current.trackCheckout("cs_test_new");
    });
    expect(settled).toHaveBeenCalledWith({ ...result, status: "failed" });
    expect(localStorage.getItem("tiao:stripe-checkout:alice")).toBeNull();
    unmount();
  });

  it("rejects malformed links", () => {
    for (const value of [
      null,
      "",
      "cs_",
      "cs_test_a/evil",
      "https://attacker.example",
      "cs_" + "x".repeat(300),
    ])
      expect(isCheckoutSessionId(value)).toBe(false);
    expect(isCheckoutSessionId("cs_live_123")).toBe(true);
  });

  it("drops an inaccessible checkout hint without reporting a payment failure", async () => {
    vi.mocked(getCheckoutStatus).mockRejectedValue(new ApiError(404, "not yours"));
    const settled = vi.fn();
    const { result: hook, unmount } = renderHook(() =>
      useStripeCheckout("alice", "cs_test_other", settled),
    );
    await act(async () => {});
    expect(hook.current.checkoutPending).toBe(false);
    expect(localStorage.getItem("tiao:stripe-checkout:alice")).toBeNull();
    expect(settled).not.toHaveBeenCalled();
    unmount();
  });
});
