import { describe, expect, it } from "vitest";
import { canPlacePiece, getJumpTargets, makeBoard } from "@/components/tutorial/tutorialEngine";
import { HERO_FRAMES } from "./heroGame";

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
    expect(HERO_FRAMES.at(-1)?.score).toEqual([2, 1]);
  });
});
