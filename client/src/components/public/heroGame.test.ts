import {
  confirmPendingJump,
  createInitialGameState,
  getSelectableJumpOrigins,
  jumpPiece,
  placePiece,
} from "@shared";
import { describe, expect, it } from "vitest";
import { canPlacePiece, getJumpTargets, makeBoard } from "@/components/tutorial/tutorialEngine";
import { HERO_FRAMES } from "./heroGame";
import recording from "./heroGameRecording.json";

describe("hero game replay", () => {
  it("uses legal alternating placements, legal chains and confirmed capture scores", () => {
    for (let i = 1; i < HERO_FRAMES.length; i++) {
      const before = HERO_FRAMES[i - 1];
      const after = HERO_FRAMES[i];
      const board = makeBoard(19);
      for (const stone of before.stones)
        board[stone.y][stone.x] = stone.color === "white" ? "W" : "B";
      const color = before.turn === "white" ? "W" : "B";
      const placed = after.stones.find(
        (stone) => !before.stones.some((old) => old.id === stone.id),
      );
      if (placed) {
        expect(placed.color).toBe(before.turn);
        expect(canPlacePiece(board, placed, color, 19).ok).toBe(true);
        expect(after.turn).not.toBe(before.turn);
      } else if (after.move) {
        const [x, y] = after.move.from;
        expect(board[y][x]).toBe(color);
        expect(
          getJumpTargets(
            board,
            { x, y },
            color,
            19,
            before.stones.filter((s) => s.captured),
          ),
        ).toContainEqual({ x: after.move.to[0], y: after.move.to[1] });
        expect(after.score).toEqual(before.score);
      } else {
        const taken = before.stones.filter((stone) => stone.captured);
        expect(taken.length).toBeGreaterThan(0);
        expect(after.stones).toEqual(before.stones.filter((stone) => !stone.captured));
        const scorer = before.turn === "white" ? 0 : 1;
        expect(after.score[scorer]).toBe(before.score[scorer] + taken.length);
      }
    }
    expect(HERO_FRAMES.at(-1)!.score.reduce((a, b) => a + b, 0)).toBeGreaterThan(2);
  });
});

it("replays the recording through the game rules and ends with five captures", () => {
  let state = createInitialGameState({ boardSize: 19, scoreToWin: 10 });
  for (const [index, move] of recording.moves.entries()) {
    if (index < recording.openingPlies) {
      expect(getSelectableJumpOrigins(state, "white")).toHaveLength(0);
      expect(getSelectableJumpOrigins(state, "black")).toHaveLength(0);
    }
    if (move.type === "place" && move.position) {
      const result = placePiece(state, move.position);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Invalid recorded placement");
      state = result.value;
    } else if (move.from && move.path) {
      let from = move.from;
      for (const to of move.path) {
        const result = jumpPiece(state, from, to);
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("Invalid recorded jump");
        state = result.value;
        from = to;
      }
      const result = confirmPendingJump(state);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Invalid recorded confirmation");
      state = result.value;
    }
  }
  expect(recording.moves.at(-1)?.path).toHaveLength(5);
  expect(state.score).toEqual(recording.score);
  expect(Math.max(...HERO_FRAMES.map((frame) => frame.stones.length))).toBeGreaterThanOrEqual(69);
});
