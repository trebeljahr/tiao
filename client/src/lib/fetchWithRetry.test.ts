import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWithRetry } from "./fetchWithRetry";

vi.mock("sonner", () => ({
  toast: {
    loading: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
  },
}));

import { toast } from "sonner";

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("fetchWithRetry", () => {
  it("returns result on first try without toasts", async () => {
    const fn = vi.fn().mockResolvedValue("ok");

    const result = await fetchWithRetry(fn, "test");

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(toast.loading).not.toHaveBeenCalled();
    expect(toast.dismiss).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("retries and returns on second attempt", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("fail")).mockResolvedValue("ok");

    const promise = fetchWithRetry(fn, "test");
    // Advance past the first retry delay (1500ms)
    await vi.advanceTimersByTimeAsync(1500);

    const result = await promise;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(toast.loading).toHaveBeenCalledTimes(1);
    expect(toast.dismiss).toHaveBeenCalledWith("retry-test");
  });

  it("retries and returns on third attempt", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("ok");

    const promise = fetchWithRetry(fn, "test");
    await vi.advanceTimersByTimeAsync(1500);
    await vi.advanceTimersByTimeAsync(3000);

    const result = await promise;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(toast.loading).toHaveBeenCalledTimes(2);
    expect(toast.dismiss).toHaveBeenCalledWith("retry-test");
  });

  it("throws after all retries are exhausted", async () => {
    const error = new Error("persistent failure");
    const fn = vi.fn().mockRejectedValue(error);

    const promise = fetchWithRetry(fn, "test").catch((e) => e);
    await vi.advanceTimersByTimeAsync(1500);
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(5000);

    const caught = await promise;
    expect(caught).toBe(error);
    expect(fn).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });

  it("calls toast.loading on each retry attempt with correct messages", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));

    const promise = fetchWithRetry(fn, "load").catch(() => {});
    await vi.advanceTimersByTimeAsync(1500);
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(5000);

    await promise;

    expect(toast.loading).toHaveBeenCalledTimes(3);
    expect(toast.loading).toHaveBeenNthCalledWith(1, "Connection issue — retrying (1/3)...", {
      id: "retry-load",
      duration: 1500,
    });
    expect(toast.loading).toHaveBeenNthCalledWith(2, "Connection issue — retrying (2/3)...", {
      id: "retry-load",
      duration: 3000,
    });
    expect(toast.loading).toHaveBeenNthCalledWith(3, "Connection issue — retrying (3/3)...", {
      id: "retry-load",
      duration: 5000,
    });
  });

  it("calls toast.error on final failure", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));

    const promise = fetchWithRetry(fn, "test").catch(() => {});
    await vi.advanceTimersByTimeAsync(1500);
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(5000);

    await promise;

    expect(toast.error).toHaveBeenCalledWith(
      "Could not connect to the server. Please check your connection.",
      { id: "retry-test" },
    );
  });

  it("does not call toast.dismiss when first attempt succeeds", async () => {
    const fn = vi.fn().mockResolvedValue("ok");

    await fetchWithRetry(fn, "test");

    expect(toast.dismiss).not.toHaveBeenCalled();
  });
});
