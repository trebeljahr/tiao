import { getWinner } from "@shared";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PuzzleMove } from "./puzzleRules";
import { PUZZLES } from "./puzzles";
import { usePuzzleGame } from "./usePuzzleGame";

afterEach(() => vi.useRealTimers());

describe("puzzle sessions", () => {
  for (const puzzle of PUZZLES) {
    it(`${puzzle.id}: plays the verified line through confirmation and opponent reply`, () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => usePuzzleGame(puzzle));
      function play(move: PuzzleMove) {
        if (move.type === "place") {
          act(() => result.current.click(move.position));
        } else {
          act(() => result.current.click(move.from));
          for (const to of move.path) act(() => result.current.click(to));
          expect(result.current.phase).toBe("playing");
          act(() => result.current.confirm());
        }
      }
      play(puzzle.line[0]);
      if (puzzle.turns > 1) {
        expect(result.current.phase).toBe("reply");
        const before = result.current.game;
        act(() => result.current.click({ x: 4, y: 4 }));
        expect(result.current.game).toBe(before);
        act(() => vi.advanceTimersByTime(650));
        expect(result.current.phase).toBe("playing");
        expect(result.current.game.currentTurn).toBe(puzzle.player);
        play(puzzle.line[2]);
      }
      expect(result.current.phase).toBe("solved");
      expect(getWinner(result.current.game)).toBe(puzzle.player);
    });
  }

  it("rejects a tempting continuation and gives a concrete winning refutation", () => {
    const { result } = renderHook(() => usePuzzleGame(PUZZLES[3]));
    for (const point of [
      { x: 2, y: 5 },
      { x: 2, y: 3 },
      { x: 4, y: 1 },
    ]) {
      act(() => result.current.click(point));
    }
    act(() => result.current.confirm());
    expect(result.current.phase).toBe("failed");
    expect(result.current.feedback).toContain("White can win");
    act(() => result.current.reset());
    expect(result.current.phase).toBe("playing");
    expect(result.current.turnsPlayed).toBe(0);
    expect(result.current.game.score).toEqual(PUZZLES[3].score);
  });

  it("undoes a pending step and does not grade it before confirmation", () => {
    const { result } = renderHook(() => usePuzzleGame(PUZZLES[0]));
    act(() => result.current.click({ x: 2, y: 3 }));
    act(() => result.current.click({ x: 2, y: 5 }));
    expect(result.current.phase).toBe("playing");
    expect(result.current.turnsPlayed).toBe(0);
    act(() => result.current.undoJump());
    expect(result.current.game.pendingJump).toEqual([]);
    expect(result.current.game.positions[3][2]).toBe("white");
  });

  it("cancels a scheduled opponent reply when reset", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => usePuzzleGame(PUZZLES[1]));
    act(() => result.current.click({ x: 5, y: 4 }));
    expect(result.current.phase).toBe("reply");
    act(() => result.current.reset());
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.game.positions[0][3]).toBe(null);
    expect(result.current.phase).toBe("playing");
  });
});
