import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGameClock, useFirstMoveCountdown, formatClockTime } from "./GameClock";

describe("formatClockTime", () => {
  it("formats zero as 0:00", () => {
    expect(formatClockTime(0)).toBe("0:00");
  });

  it("formats negative as 0:00", () => {
    expect(formatClockTime(-1000)).toBe("0:00");
  });

  it("formats 60 seconds as 1:00", () => {
    expect(formatClockTime(60_000)).toBe("1:00");
  });

  it("formats 30.5 seconds as 0:31 (ceiling)", () => {
    expect(formatClockTime(30_500)).toBe("0:31");
  });

  it("formats 5 minutes as 5:00", () => {
    expect(formatClockTime(300_000)).toBe("5:00");
  });
});

describe("useGameClock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns full clock times when game is not active", () => {
    const clock = {
      white: 60_000,
      black: 60_000,
      lastMoveAt: new Date().toISOString(),
    };

    const { result } = renderHook(() => useGameClock(clock, "white", "waiting"));

    expect(result.current.whiteTime).toBe(60_000);
    expect(result.current.blackTime).toBe(60_000);
  });

  it("returns zeros when clock is null", () => {
    const { result } = renderHook(() => useGameClock(null, "white", "active"));

    expect(result.current.whiteTime).toBe(0);
    expect(result.current.blackTime).toBe(0);
  });

  it("deducts elapsed time from current player when active", () => {
    vi.useFakeTimers();
    const now = Date.now();

    const clock = {
      white: 60_000,
      black: 60_000,
      lastMoveAt: new Date(now - 5000).toISOString(), // 5s ago
    };

    const { result } = renderHook(() => useGameClock(clock, "white", "active"));

    // White should have ~55s left (60s - 5s elapsed)
    expect(result.current.whiteTime).toBeLessThanOrEqual(55_000);
    expect(result.current.whiteTime).toBeGreaterThan(54_000);
    // Black should be unchanged
    expect(result.current.blackTime).toBe(60_000);

    vi.useRealTimers();
  });

  it("does not deduct from non-current player", () => {
    vi.useFakeTimers();
    const now = Date.now();

    const clock = {
      white: 60_000,
      black: 60_000,
      lastMoveAt: new Date(now - 5000).toISOString(),
    };

    const { result } = renderHook(() => useGameClock(clock, "black", "active"));

    // White should be unchanged (it's black's turn)
    expect(result.current.whiteTime).toBe(60_000);
    // Black should have elapsed deducted
    expect(result.current.blackTime).toBeLessThanOrEqual(55_000);

    vi.useRealTimers();
  });

  it("frozen clock before first move shows full time", () => {
    // Server sends lastMoveAt = now when no move has been made,
    // so elapsed should be ~0
    const clock = {
      white: 60_000,
      black: 60_000,
      lastMoveAt: new Date().toISOString(),
    };

    const { result } = renderHook(() => useGameClock(clock, "white", "active"));

    // Should be very close to 60s (only ms have passed)
    expect(result.current.whiteTime).toBeGreaterThan(59_900);
    expect(result.current.blackTime).toBe(60_000);
  });

  it("does not deduct elapsed time while firstMoveDeadline is set", () => {
    vi.useFakeTimers();
    const now = Date.now();

    const clock = {
      white: 60_000,
      black: 60_000,
      lastMoveAt: new Date(now - 10_000).toISOString(), // 10s ago
    };

    const { result } = renderHook(() =>
      useGameClock(clock, "white", "active", {
        firstMoveDeadline: new Date(now + 20_000).toISOString(),
      }),
    );

    // Clock should be frozen — no elapsed time deducted
    expect(result.current.whiteTime).toBe(60_000);
    expect(result.current.blackTime).toBe(60_000);

    vi.useRealTimers();
  });

  it("starts ticking once firstMoveDeadline is cleared", () => {
    vi.useFakeTimers();
    const now = Date.now();

    const clock = {
      white: 60_000,
      black: 60_000,
      lastMoveAt: new Date(now - 5_000).toISOString(),
    };

    // First render: deadline still active
    const { result, rerender } = renderHook(
      ({ deadline }) =>
        useGameClock(clock, "white", "active", {
          firstMoveDeadline: deadline,
        }),
      { initialProps: { deadline: new Date(now + 20_000).toISOString() as string | null } },
    );

    expect(result.current.whiteTime).toBe(60_000);

    // Deadline cleared (first move was made)
    rerender({ deadline: null });

    // Now clock should tick — white has ~55s
    expect(result.current.whiteTime).toBeLessThanOrEqual(55_000);
    expect(result.current.whiteTime).toBeGreaterThan(54_000);

    vi.useRealTimers();
  });
});

describe("useFirstMoveCountdown", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null when no deadline", () => {
    const { result } = renderHook(() => useFirstMoveCountdown(null, "active"));

    expect(result.current).toBeNull();
  });

  it("returns remaining ms even when game is waiting (deadline present)", () => {
    const deadline = new Date(Date.now() + 30_000).toISOString();
    const { result } = renderHook(() => useFirstMoveCountdown(deadline, "waiting"));

    // The hook still calculates remaining time; the UI decides when to show it
    expect(result.current).not.toBeNull();
    expect(result.current!).toBeGreaterThan(29_000);
  });

  it("returns remaining ms when deadline is in the future", () => {
    const deadline = new Date(Date.now() + 25_000).toISOString();
    const { result } = renderHook(() => useFirstMoveCountdown(deadline, "active"));

    expect(result.current).not.toBeNull();
    expect(result.current!).toBeGreaterThan(24_000);
    expect(result.current!).toBeLessThanOrEqual(25_000);
  });

  it("returns 0 when deadline has passed", () => {
    const deadline = new Date(Date.now() - 1000).toISOString();
    const { result } = renderHook(() => useFirstMoveCountdown(deadline, "active"));

    expect(result.current).toBe(0);
  });

  it("ticks down over time", async () => {
    vi.useFakeTimers();
    const deadline = new Date(Date.now() + 20_000).toISOString();

    const { result } = renderHook(() => useFirstMoveCountdown(deadline, "active"));

    const initial = result.current!;
    expect(initial).toBeGreaterThan(19_000);

    // Advance 5 seconds
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    const after5s = result.current!;
    expect(after5s).toBeLessThanOrEqual(initial - 4900);
    expect(after5s).toBeGreaterThan(0);

    vi.useRealTimers();
  });
});
