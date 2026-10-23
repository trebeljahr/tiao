import { confirmPendingJump, createInitialGameState, jumpPiece, placePiece } from "@shared";
import { describe, expect, it } from "vitest";
import { canPlacePiece, getJumpTargets, makeBoard } from "@/components/tutorial/tutorialEngine";
import { HERO_FRAMES, HERO_PRE_JUMP_FRAME } from "./heroGame";
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

it("replays the recording through the game rules and completes all six captures despite White’s defence", () => {
  let state = createInitialGameState({ boardSize: 19, scoreToWin: 10 });
  for (const stone of recording.initial.stones) {
    state.positions[stone.y][stone.x] = stone.color as "white" | "black";
  }
  for (const move of recording.moves) {
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
  expect(recording.moves.at(-1)?.path).toHaveLength(6);
  expect(state.score).toEqual(recording.score);
  expect(state.score).toEqual({ white: 0, black: 6 });
  expect(HERO_FRAMES.filter((frame) => frame.move)).toHaveLength(6);
  expect(HERO_FRAMES.at(-1)!.score).toEqual([0, 6]);
  expect(HERO_FRAMES.at(-1)!.stones.some((stone) => stone.captured)).toBe(false);
  const board = makeBoard(19);
  for (const stone of HERO_FRAMES.at(-1)!.stones)
    board[stone.y][stone.x] = stone.color === "white" ? "W" : "B";
  expect(getJumpTargets(board, { x: 11, y: 7 }, "B", 19)).toEqual([]);
});

it("builds White’s second cluster from its centre without leaving a hollow eye", () => {
  const outer = [
    { x: 7, y: 6 },
    { x: 6, y: 7 },
    { x: 8, y: 7 },
    { x: 7, y: 8 },
  ];
  for (const frame of HERO_FRAMES) {
    if (
      outer.some((position) =>
        frame.stones.some((stone) => stone.x === position.x && stone.y === position.y),
      )
    ) {
      expect(frame.stones).toContainEqual(expect.objectContaining({ x: 7, y: 7, color: "white" }));
    }
  }
  expect(HERO_PRE_JUMP_FRAME.stones).toContainEqual(
    expect.objectContaining({ x: 7, y: 8, color: "white" }),
  );
});

it("lets White block a diagonal jump before Black captures the cluster by another route", () => {
  const beforeDefence = HERO_FRAMES[HERO_FRAMES.indexOf(HERO_PRE_JUMP_FRAME) - 1];
  const targets = (frame: typeof HERO_PRE_JUMP_FRAME) => {
    const board = makeBoard(19);
    for (const stone of frame.stones) board[stone.y][stone.x] = stone.color === "white" ? "W" : "B";
    return getJumpTargets(board, { x: 11, y: 7 }, "B", 19);
  };
  expect(targets(beforeDefence)).toContainEqual({ x: 9, y: 5 });
  expect(HERO_PRE_JUMP_FRAME.stones).toContainEqual(
    expect.objectContaining({ x: 9, y: 5, color: "white" }),
  );
  expect(targets(HERO_PRE_JUMP_FRAME)).not.toContainEqual({ x: 9, y: 5 });
  expect(targets(HERO_PRE_JUMP_FRAME)).toContainEqual({ x: 11, y: 9 });
  const ending = HERO_FRAMES.at(-1)!;
  const invadedCluster = HERO_PRE_JUMP_FRAME.stones.filter(
    (stone) =>
      stone.color === "white" && stone.x >= 10 && stone.x <= 12 && stone.y >= 6 && stone.y <= 8,
  );
  expect(invadedCluster).toHaveLength(6);
  for (const stone of invadedCluster)
    expect(ending.stones.some((remaining) => remaining.id === stone.id)).toBe(false);
});
