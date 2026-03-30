import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError } from "@/lib/api";
import { readableError, isNetworkError, isRetryableError, toastError } from "./errors";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

import { toast } from "sonner";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("readableError", () => {
  it("returns the string directly for string input", () => {
    expect(readableError("Something broke")).toBe("Something broke");
  });

  it("returns message from ApiError", () => {
    const err = new ApiError(404, "Not found");
    expect(readableError(err)).toBe("Not found");
  });

  it("returns message from regular Error", () => {
    const err = new Error("Oops");
    expect(readableError(err)).toBe("Oops");
  });

  it("returns fallback for null", () => {
    expect(readableError(null)).toBe("Something went wrong.");
  });

  it("returns fallback for undefined", () => {
    expect(readableError(undefined)).toBe("Something went wrong.");
  });

  it("returns fallback for plain object", () => {
    expect(readableError({ foo: "bar" })).toBe("Something went wrong.");
  });

  it("returns fallback for number", () => {
    expect(readableError(42)).toBe("Something went wrong.");
  });
});

describe("isNetworkError", () => {
  it("returns true for ApiError with status 0", () => {
    expect(isNetworkError(new ApiError(0, "Network error"))).toBe(true);
  });

  it("returns false for ApiError with status 500", () => {
    expect(isNetworkError(new ApiError(500, "Server error"))).toBe(false);
  });

  it("returns false for ApiError with status 404", () => {
    expect(isNetworkError(new ApiError(404, "Not found"))).toBe(false);
  });

  it("returns false for regular Error", () => {
    expect(isNetworkError(new Error("fail"))).toBe(false);
  });

  it("returns false for string", () => {
    expect(isNetworkError("network error")).toBe(false);
  });
});

describe("isRetryableError", () => {
  it("returns true for network error (status 0)", () => {
    expect(isRetryableError(new ApiError(0, "Network error"))).toBe(true);
  });

  it("returns true for status 500", () => {
    expect(isRetryableError(new ApiError(500, "Internal server error"))).toBe(true);
  });

  it("returns true for status 502", () => {
    expect(isRetryableError(new ApiError(502, "Bad gateway"))).toBe(true);
  });

  it("returns true for status 503", () => {
    expect(isRetryableError(new ApiError(503, "Service unavailable"))).toBe(true);
  });

  it("returns false for status 400", () => {
    expect(isRetryableError(new ApiError(400, "Bad request"))).toBe(false);
  });

  it("returns false for status 404", () => {
    expect(isRetryableError(new ApiError(404, "Not found"))).toBe(false);
  });

  it("returns false for regular Error", () => {
    expect(isRetryableError(new Error("fail"))).toBe(false);
  });

  it("returns false for non-error values", () => {
    expect(isRetryableError("error")).toBe(false);
    expect(isRetryableError(null)).toBe(false);
  });
});

describe("toastError", () => {
  it("calls toast.error with the readable message for a string", () => {
    toastError("Something broke");
    expect(toast.error).toHaveBeenCalledWith("Something broke");
  });

  it("calls toast.error with ApiError message", () => {
    toastError(new ApiError(500, "Server error"));
    expect(toast.error).toHaveBeenCalledWith("Server error");
  });

  it("calls toast.error with fallback for unknown input", () => {
    toastError(null);
    expect(toast.error).toHaveBeenCalledWith("Something went wrong.");
  });
});
