import {
  canPlacePiece,
  confirmPendingJump,
  createInitialGameState,
  getJumpTargets,
  getWinner,
  jumpPiece,
} from "@shared";
import { describe, expect, it } from "vitest";
import {
  canForcePuzzleWin,
  playPuzzleMove,
  puzzleMoveKey,
  puzzleTurns,
  winningPuzzleTurns,
} from "./puzzleRules";
import { createPuzzleState, PUZZLES } from "./puzzles";

describe("composed puzzle proofs", () => {
  for (const puzzle of PUZZLES) {
    it(`${puzzle.id}: unique first turn and a win against every legal reply`, () => {
      expect(puzzle.rows).toHaveLength(9);
      for (const row of puzzle.rows) expect(row).toMatch(/^[.WB]{9}$/);
      const start = createPuzzleState(puzzle);
      const before = JSON.stringify(start);
      const wins = winningPuzzleTurns(start, puzzle.turns * 2 - 1);
      expect(wins.map((turn) => puzzleMoveKey(turn.move))).toEqual([puzzleMoveKey(puzzle.line[0])]);
      expect(JSON.stringify(start)).toBe(before);
      if (puzzle.turns > 1) {
        expect(winningPuzzleTurns(start, 1)).toEqual([]);
        const replies = [...puzzleTurns(wins[0].state)];
        expect(replies.length).toBeGreaterThan(30);
        // Enumerate placements and every jump prefix, without the bot's caps.
        for (const reply of replies) {
          expect(canForcePuzzleWin(reply.state, puzzle.player, 1), puzzleMoveKey(reply.move)).toBe(
            true,
          );
        }
      }
      let state = start;
      for (const move of puzzle.line) state = playPuzzleMove(state, move);
      expect(getWinner(state)).toBe(puzzle.player);
    });
  }

  it("includes early confirmation and obeys pending-capture occupancy", () => {
    const state = createInitialGameState({ boardSize: 9 });
    state.positions[4][2] = "white";
    state.positions[4][3] = "black";
    state.positions[5][4] = "black";
    const moves = [...puzzleTurns(state)].filter((turn) => turn.move.type === "jump");
    expect(moves.map((turn) => puzzleMoveKey(turn.move))).toEqual(["j:2,4:4,4", "j:2,4:4,4:4,6"]);
    const pending = jumpPiece(state, { x: 2, y: 4 }, { x: 4, y: 4 });
    expect(pending.ok).toBe(true);
    if (!pending.ok) return;
    expect(pending.value.positions[4][3]).toBe("black");
    expect(getJumpTargets(pending.value, { x: 4, y: 4 })).not.toContainEqual({ x: 2, y: 4 });
    const confirmed = confirmPendingJump(pending.value);
    expect(confirmed.ok && confirmed.value.positions[4][3]).toBe(null);
  });

  it("proves why continuing the early-stop study loses immediately", () => {
    const start = createPuzzleState(PUZZLES[3]);
    const greedy = playPuzzleMove(start, {
      type: "jump",
      from: { x: 2, y: 5 },
      path: [
        { x: 2, y: 3 },
        { x: 4, y: 1 },
      ],
    });
    const refutation = playPuzzleMove(greedy, {
      type: "jump",
      from: { x: 4, y: 5 },
      path: [
        { x: 2, y: 3 },
        { x: 0, y: 1 },
      ],
    });
    expect(getWinner(refutation)).toBe("white");
  });

  it("checks both branches of the sacrifice", () => {
    const puzzle = PUZZLES[5];
    const placed = playPuzzleMove(createPuzzleState(puzzle), puzzle.line[0]);
    const otherCapture = playPuzzleMove(placed, {
      type: "jump",
      from: { x: 3, y: 5 },
      path: [{ x: 3, y: 7 }],
    });
    const win = playPuzzleMove(otherCapture, {
      type: "jump",
      from: { x: 4, y: 5 },
      path: [
        { x: 4, y: 7 },
        { x: 2, y: 7 },
      ],
    });
    expect(getWinner(win)).toBe("black");
  });

  it("uses the actual border rule for the edge study", () => {
    const start = createPuzzleState(PUZZLES[4]);
    expect(canPlacePiece(start, { x: 8, y: 3 }).ok).toBe(true);
    expect(canPlacePiece(start, { x: 0, y: 0 }).ok).toBe(false);
  });
});
