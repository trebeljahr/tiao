import { findConnectedCluster, type GameState, getWinner } from "@shared";
import { describe, expect, it } from "vitest";
import catalogue from "./generatedPuzzles.json";
import {
  canonicalPuzzleBoard,
  type GeneratedPuzzleRecord,
  simulatedGame,
} from "./puzzleGeneration";
import { PUZZLE_POOL } from "./puzzlePool";
import {
  canForcePuzzleWin,
  playPuzzleMove,
  puzzleMoveKey,
  puzzleTurns,
  winningPuzzleTurns,
} from "./puzzleRules";
import { createPuzzleState } from "./puzzles";

const records = catalogue as GeneratedPuzzleRecord[];

// The existing cluster validator and written rules differ for merged groups.
// Keep these positions and their source histories away from that discrepancy.
function checkClusters(state: GameState) {
  const seen = new Set<string>();
  for (let y = 0; y < state.boardSize; y++) {
    for (let x = 0; x < state.boardSize; x++) {
      if (!state.positions[y][x] || seen.has(`${x},${y}`)) continue;
      const group = findConnectedCluster(state, { x, y });
      expect(group.length).toBeLessThanOrEqual(10);
      for (const point of group) seen.add(`${point.x},${point.y}`);
    }
  }
}

describe("mined puzzle catalogue", () => {
  it("recognizes rotated, reflected, recolored and rescored copies as the same board", () => {
    const state = createPuzzleState(PUZZLE_POOL[0]);
    const rotated = {
      ...state,
      positions: state.positions.map((row, y) => row.map((_cell, x) => state.positions[8 - x][y])),
    };
    const reflected = { ...state, positions: state.positions.map((row) => [...row].reverse()) };
    const recolored = {
      ...state,
      currentTurn: state.currentTurn === "white" ? ("black" as const) : ("white" as const),
      positions: state.positions.map((row) =>
        row.map((cell) =>
          cell === null ? null : cell === "white" ? ("black" as const) : ("white" as const),
        ),
      ),
      score: { white: 0, black: 1 },
    };
    expect(canonicalPuzzleBoard(rotated)).toBe(canonicalPuzzleBoard(state));
    expect(canonicalPuzzleBoard(reflected)).toBe(canonicalPuzzleBoard(state));
    expect(canonicalPuzzleBoard(recolored)).toBe(canonicalPuzzleBoard(state));
  });
  it("contains 200 distinct positions rather than rotated, reflected, recolored, or rescored copies", () => {
    expect(PUZZLE_POOL).toHaveLength(200);
    expect(
      new Set(PUZZLE_POOL.map((puzzle) => canonicalPuzzleBoard(createPuzzleState(puzzle)))).size,
    ).toBe(PUZZLE_POOL.length);
    expect(new Set(records.map((record) => record.source.seed)).size).toBe(records.length);
  });
  it("replays every source from an empty board using only legal turns", () => {
    for (const record of records) {
      let ply = 0;
      let found = false;
      for (const state of simulatedGame(record.source.seed)) {
        checkClusters(state);
        if (ply++ !== record.source.ply) continue;
        expect(state.currentTurn).toBe(record.player);
        expect(state.score).toEqual(record.score);
        expect(
          state.positions.map((row) =>
            row.map((cell) => (cell === null ? "." : cell === "white" ? "W" : "B")).join(""),
          ),
        ).toEqual(record.rows);
        found = true;
        break;
      }
      expect(found).toBe(true);
    }
  }, 120000);
  it("proves every unique opening, every defence, and every illustrated solution without mining limits", () => {
    for (const puzzle of PUZZLE_POOL) {
      const state = createPuzzleState(puzzle);
      const wins = winningPuzzleTurns(state, puzzle.turns * 2 - 1);
      expect(
        wins.map((turn) => puzzleMoveKey(turn.move)),
        puzzle.id,
      ).toEqual([puzzleMoveKey(puzzle.line[0])]);
      if (puzzle.turns === 2) {
        expect(winningPuzzleTurns(state, 1), puzzle.id).toEqual([]);
        for (const reply of puzzleTurns(wins[0].state)) {
          expect(
            canForcePuzzleWin(reply.state, puzzle.player, 1),
            `${puzzle.id}: ${puzzleMoveKey(reply.move)}`,
          ).toBe(true);
        }
      }
      let final = state;
      for (const move of puzzle.line) {
        final = playPuzzleMove(final, move);
        checkClusters(final);
      }
      expect(getWinner(final), puzzle.id).toBe(puzzle.player);
    }
  }, 120000);
  it("mixes chain lengths, setups by placement and setups by capture, without naming the solution", () => {
    expect(
      PUZZLE_POOL.some(
        (puzzle) =>
          puzzle.turns === 1 && puzzle.line[0].type === "jump" && puzzle.line[0].path.length >= 3,
      ),
    ).toBe(true);
    expect(
      PUZZLE_POOL.some((puzzle) => puzzle.turns === 2 && puzzle.line[0].type === "place"),
    ).toBe(true);
    expect(PUZZLE_POOL.some((puzzle) => puzzle.turns === 2 && puzzle.line[0].type === "jump")).toBe(
      true,
    );
    for (const puzzle of PUZZLE_POOL) expect(puzzle.title).toMatch(/^Puzzle \d{3}$/);
  });
});
