import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { PlayerColor } from "@shared";

// Mock canvas-confetti before importing the hook
const mockConfetti = vi.fn();
vi.mock("canvas-confetti", () => ({
  default: (...args: unknown[]) => mockConfetti(...args),
}));

// Mock requestAnimationFrame to run synchronously (single frame only)

import { useWinConfetti } from "./useWinConfetti";

describe("useWinConfetti", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Make requestAnimationFrame capture but not recurse — we only need to
    // verify the first confetti() call to know which branch was taken.
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((_cb) => {
      // Don't invoke cb — prevents infinite recursion in the animation loop.
      return 0;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fires victory confetti when winner matches viewerColor", () => {
    renderHook(() => useWinConfetti("white", { viewerColor: "white" }));

    expect(mockConfetti).toHaveBeenCalled();
    // Victory confetti uses particleCount: 120
    const call = mockConfetti.mock.calls[0][0];
    expect(call.particleCount).toBe(120);
    expect(call.startVelocity).toBe(45);
  });

  it("fires defeat particles when winner does NOT match viewerColor", () => {
    renderHook(() => useWinConfetti("black", { viewerColor: "white" }));

    expect(mockConfetti).toHaveBeenCalled();
    // Defeat particles use particleCount: 2
    const call = mockConfetti.mock.calls[0][0];
    expect(call.particleCount).toBe(2);
    expect(call.startVelocity).toBe(8);
    expect(call.shapes).toEqual(["circle"]);
  });

  it("fires victory confetti when viewerColor is null (local mode)", () => {
    renderHook(() => useWinConfetti("white", { viewerColor: null }));

    expect(mockConfetti).toHaveBeenCalled();
    const call = mockConfetti.mock.calls[0][0];
    expect(call.particleCount).toBe(120);
  });

  it("fires victory confetti when options are omitted entirely (local mode default)", () => {
    renderHook(() => useWinConfetti("black"));

    expect(mockConfetti).toHaveBeenCalled();
    const call = mockConfetti.mock.calls[0][0];
    expect(call.particleCount).toBe(120);
  });

  it("does NOT fire confetti when winner is null", () => {
    renderHook(() => useWinConfetti(null, { viewerColor: "white" }));

    expect(mockConfetti).not.toHaveBeenCalled();
  });

  it("does NOT re-trigger when re-rendered with the same winner", () => {
    const { rerender } = renderHook(
      ({ winner, viewerColor }: { winner: PlayerColor | null; viewerColor: PlayerColor | null }) =>
        useWinConfetti(winner, { viewerColor }),
      {
        initialProps: {
          winner: "white" as PlayerColor | null,
          viewerColor: "white" as PlayerColor | null,
        },
      },
    );

    const callCountAfterFirst = mockConfetti.mock.calls.length;
    expect(callCountAfterFirst).toBeGreaterThan(0);

    // Re-render with same winner — should NOT trigger again
    rerender({ winner: "white", viewerColor: "white" });

    expect(mockConfetti.mock.calls.length).toBe(callCountAfterFirst);
  });

  it("resets and can re-trigger after winner goes null then back", () => {
    const { rerender } = renderHook(
      ({ winner }: { winner: PlayerColor | null }) => useWinConfetti(winner),
      { initialProps: { winner: "white" as PlayerColor | null } },
    );

    const firstCount = mockConfetti.mock.calls.length;
    expect(firstCount).toBeGreaterThan(0);

    // Winner goes null
    rerender({ winner: null });

    // Winner comes back
    rerender({ winner: "white" });

    expect(mockConfetti.mock.calls.length).toBeGreaterThan(firstCount);
  });

  it("uses correct colors for white winner victory confetti", () => {
    renderHook(() => useWinConfetti("white", { viewerColor: "white" }));

    const call = mockConfetti.mock.calls[0][0];
    expect(call.colors).toEqual([
      "#ff6b6b",
      "#feca57",
      "#48dbfb",
      "#ff9ff3",
      "#54a0ff",
      "#5f27cd",
      "#01a3a4",
      "#f368e0",
      "#ff9f43",
      "#00d2d3",
    ]);
  });

  it("uses correct colors for black winner victory confetti", () => {
    renderHook(() => useWinConfetti("black", { viewerColor: "black" }));

    const call = mockConfetti.mock.calls[0][0];
    expect(call.colors).toEqual([
      "#ff6b6b",
      "#feca57",
      "#48dbfb",
      "#ff9ff3",
      "#54a0ff",
      "#5f27cd",
      "#01a3a4",
      "#f368e0",
      "#ff9f43",
      "#00d2d3",
    ]);
  });
});
