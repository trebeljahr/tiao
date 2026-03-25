import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useComputerGame } from "./useComputerGame";

vi.mock("../computer-ai", () => ({
  COMPUTER_COLOR: "black" as const,
  COMPUTER_THINK_MS: 440,
  requestComputerMove: vi.fn(() => ({
    promise: new Promise(() => {}), // never resolves
    cancel: vi.fn(),
  })),
  applyComputerTurnPlan: vi.fn(),
}));

describe("useComputerGame", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with white (human) to move", () => {
    const { result } = renderHook(() => useComputerGame());
    expect(result.current.localGame.currentTurn).toBe("white");
    expect(result.current.computerThinking).toBe(false);
  });

  it("blocks human clicks during computer turn", () => {
    const { result } = renderHook(() => useComputerGame());

    act(() => result.current.handleLocalBoardClick({ x: 9, y: 9 }));
    expect(result.current.localGame.positions[9][9]).toBe("white");
    expect(result.current.localGame.currentTurn).toBe("black");

    act(() => result.current.handleLocalBoardClick({ x: 8, y: 8 }));
    expect(result.current.localGame.positions[8][8]).toBeNull();
  });

  it("controlsDisabled is true during computer turn", () => {
    const { result } = renderHook(() => useComputerGame());

    act(() => result.current.handleLocalBoardClick({ x: 9, y: 9 }));
    expect(result.current.controlsDisabled).toBe(true);
    expect(result.current.localGame.currentTurn).toBe("black");
  });

  it("controlsDisabled is false on human turn", () => {
    const { result } = renderHook(() => useComputerGame());
    expect(result.current.controlsDisabled).toBe(false);
    expect(result.current.localGame.currentTurn).toBe("white");
  });
});
