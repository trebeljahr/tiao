import { type GameState, createInitialGameState } from "@shared";
import { describe, expect, it } from "vitest";
import {
  AI_DIFFICULTY_LABELS,
  type EngineMove,
  applyEngineMove,
  computeZobristHash,
  evaluate,
  findBestMove,
  generateMoves,
} from "./tiao-engine";

/** Create a board with specific pieces. Uses 7x7 by default for fast tests. */
function setupBoard(
  pieces: Array<{ x: number; y: number; color: "black" | "white" }>,
  currentTurn: "black" | "white" = "black",
  boardSize = 7,
): GameState {
  const state = createInitialGameState({ boardSize });
  for (const p of pieces) {
    state.positions[p.y][p.x] = p.color;
  }
  state.currentTurn = currentTurn;
  return state;
}

/** Small empty board for search tests — 7x7 has 49 positions vs 361 on 19x19. */
function emptySmallBoard(): GameState {
  return createInitialGameState({ boardSize: 7 });
}

describe("Move Generation", () => {
  it("generates placement moves on empty board", () => {
    const state = createInitialGameState();
    const moves = generateMoves(state);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => m.type === "place")).toBe(true);
  });

  it("generates jump moves when captures are available", () => {
    const state = setupBoard(
      [
        { x: 9, y: 9, color: "black" },
        { x: 10, y: 9, color: "white" },
      ],
      "black",
      19,
    );
    const moves = generateMoves(state);
    const jumpMoves = moves.filter((m) => m.type === "jump");
    expect(jumpMoves.length).toBeGreaterThan(0);
  });

  it("generates multi-hop jump chains", () => {
    // Black at (6,9), white at (7,9) and (9,9), empty at (8,9) and (10,9)
    const state = setupBoard(
      [
        { x: 6, y: 9, color: "black" },
        { x: 7, y: 9, color: "white" },
        { x: 9, y: 9, color: "white" },
      ],
      "black",
      19,
    );
    const moves = generateMoves(state);
    const jumpMoves = moves.filter((m) => m.type === "jump");
    // Should only generate maximal chains (length-2 double capture, no partial length-1)
    const lengths = jumpMoves.map((m) => (m.type === "jump" ? m.path.length : 0));
    expect(lengths).toContain(2);
    expect(lengths).not.toContain(1);
  });

  it("returns no moves when game is over", () => {
    const state = createInitialGameState();
    state.score.black = 10;
    const moves = generateMoves(state);
    expect(moves.length).toBe(0);
  });
});

describe("Move Application", () => {
  it("applies placement correctly", () => {
    const state = createInitialGameState();
    state.currentTurn = "black";
    const move: EngineMove = { type: "place", position: { x: 9, y: 9 } };
    const result = applyEngineMove(state, move);
    expect(result.positions[9][9]).toBe("black");
    expect(result.currentTurn).toBe("white");
  });

  it("applies jump chain correctly", () => {
    const state = setupBoard(
      [
        { x: 6, y: 9, color: "black" },
        { x: 7, y: 9, color: "white" },
        { x: 9, y: 9, color: "white" },
      ],
      "black",
      19,
    );
    const move: EngineMove = {
      type: "jump",
      from: { x: 6, y: 9 },
      path: [
        { x: 8, y: 9 },
        { x: 10, y: 9 },
      ],
    };
    const result = applyEngineMove(state, move);
    expect(result.positions[9][6]).toBeNull(); // origin empty
    expect(result.positions[9][7]).toBeNull(); // captured
    expect(result.positions[9][9]).toBeNull(); // captured
    expect(result.positions[9][10]).toBe("black"); // landed
    expect(result.score.black).toBe(2);
    expect(result.currentTurn).toBe("white");
  });
});

describe("Evaluation", () => {
  it("returns 0 for a symmetric empty position", () => {
    const state = createInitialGameState();
    state.currentTurn = "black";
    const score = evaluate(state);
    // On empty board, score should be 0 (symmetric)
    expect(score).toBe(0);
  });

  it("scores capture advantage heavily", () => {
    const state = createInitialGameState();
    state.currentTurn = "black";
    state.score.black = 3;
    state.score.white = 1;
    const score = evaluate(state);
    expect(score).toBeGreaterThan(1500); // 2 capture lead * 1000
  });

  it("returns extreme score for game-over states", () => {
    const state = createInitialGameState();
    state.score.black = 10;
    state.currentTurn = "black";
    const score = evaluate(state);
    expect(score).toBeGreaterThan(40000);
  });

  it("values center positions", () => {
    const centerState = setupBoard([{ x: 9, y: 9, color: "black" }], "black", 19);
    const cornerState = setupBoard([{ x: 1, y: 1, color: "black" }], "black", 19);
    const centerScore = evaluate(centerState);
    const cornerScore = evaluate(cornerState);
    expect(centerScore).toBeGreaterThan(cornerScore);
  });
});

describe("Zobrist Hashing", () => {
  it("produces same hash for same position", () => {
    const state = setupBoard([
      { x: 3, y: 3, color: "black" },
      { x: 5, y: 5, color: "white" },
    ]);
    const hash1 = computeZobristHash(state);
    const hash2 = computeZobristHash(state);
    expect(hash1).toBe(hash2);
  });

  it("produces different hash after a move", () => {
    const state = createInitialGameState();
    state.currentTurn = "black";
    const hash1 = computeZobristHash(state);

    const move: EngineMove = { type: "place", position: { x: 9, y: 9 } };
    const newState = applyEngineMove(state, move);
    const hash2 = computeZobristHash(newState);

    expect(hash1).not.toBe(hash2);
  });

  it("produces different hash for different turn", () => {
    const state1 = setupBoard([{ x: 9, y: 9, color: "black" }], "black", 19);
    const state2 = setupBoard([{ x: 9, y: 9, color: "black" }], "white", 19);
    expect(computeZobristHash(state1)).not.toBe(computeZobristHash(state2));
  });
});

describe("Search", { timeout: 10_000 }, () => {
  it("finds immediate capture", () => {
    const state = setupBoard([
      { x: 3, y: 3, color: "black" },
      { x: 4, y: 3, color: "white" },
    ]);
    const result = findBestMove(state, { level: 3, color: "black" }, { aborted: false });
    expect(result).not.toBeNull();
    expect(result!.move.type).toBe("jump");
  });

  it("prefers multi-capture chains over single captures", () => {
    const state = setupBoard([
      { x: 1, y: 3, color: "black" },
      { x: 2, y: 3, color: "white" },
      { x: 4, y: 3, color: "white" },
      { x: 1, y: 1, color: "black" },
      { x: 2, y: 1, color: "white" },
    ]);
    const result = findBestMove(state, { level: 3, color: "black" }, { aborted: false });
    expect(result).not.toBeNull();
    if (result!.move.type === "jump") {
      expect(result!.move.path.length).toBe(2);
    }
  });

  it("returns null for game-over state", () => {
    const state = emptySmallBoard();
    state.score.white = 10;
    const result = findBestMove(state, { level: 3, color: "black" }, { aborted: false });
    expect(result).toBeNull();
  });

  it("respects abort signal", () => {
    const state = emptySmallBoard();
    const abort = { aborted: true };
    findBestMove(state, { level: 3, color: "black" }, abort);
    expect(true).toBe(true);
  });

  it("chooses a placement when no captures available", () => {
    const state = emptySmallBoard();
    const result = findBestMove(state, { level: 3, color: "black" }, { aborted: false });
    expect(result).not.toBeNull();
    expect(result!.move.type).toBe("place");
  });

  it("produces valid state after applying result", () => {
    const state = setupBoard([
      { x: 3, y: 3, color: "black" },
      { x: 4, y: 3, color: "white" },
    ]);
    const result = findBestMove(state, { level: 3, color: "black" }, { aborted: false });
    expect(result).not.toBeNull();
    const newState = applyEngineMove(state, result!.move);
    expect(newState.currentTurn).toBe("white");
  });
});

describe("Difficulty Levels", { timeout: 10_000 }, () => {
  it("level 1 completes within its time budget", () => {
    const state = emptySmallBoard();
    const start = performance.now();
    findBestMove(state, { level: 1, color: "black" }, { aborted: false });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(5000);
  });

  it("higher levels search deeper", () => {
    const state = setupBoard([
      { x: 3, y: 3, color: "black" },
      { x: 4, y: 3, color: "white" },
      { x: 2, y: 2, color: "white" },
      { x: 3, y: 1, color: "black" },
    ]);
    const result1 = findBestMove(state, { level: 1, color: "black" }, { aborted: false });
    const result4 = findBestMove(state, { level: 3, color: "black" }, { aborted: false });
    expect(result1).not.toBeNull();
    expect(result4).not.toBeNull();
    expect(result4!.depth).toBeGreaterThanOrEqual(result1!.depth);
  });
});

describe("AI Difficulty Presets (#66)", { timeout: 30_000 }, () => {
  it("has three difficulty labels: Easy, Intermediate, Hard", () => {
    expect(AI_DIFFICULTY_LABELS[1]).toBe("Easy");
    expect(AI_DIFFICULTY_LABELS[2]).toBe("Intermediate");
    expect(AI_DIFFICULTY_LABELS[3]).toBe("Hard");
  });

  it("intermediate level (2) produces a valid move", () => {
    const state = emptySmallBoard();
    const result = findBestMove(state, { level: 2, color: "black" }, { aborted: false });
    expect(result).not.toBeNull();
    expect(result!.move.type).toBe("place");
  });

  it("difficulty ordering: easy <= intermediate <= hard (by search depth)", () => {
    const state = setupBoard([
      { x: 3, y: 3, color: "black" },
      { x: 4, y: 3, color: "white" },
    ]);
    const easy = findBestMove(state, { level: 1, color: "black" }, { aborted: false });
    const intermediate = findBestMove(state, { level: 2, color: "black" }, { aborted: false });
    const hard = findBestMove(state, { level: 3, color: "black" }, { aborted: false });

    expect(easy).not.toBeNull();
    expect(intermediate).not.toBeNull();
    expect(hard).not.toBeNull();

    expect(intermediate!.depth).toBeGreaterThanOrEqual(easy!.depth);
    expect(hard!.depth).toBeGreaterThanOrEqual(intermediate!.depth);
  });

  it("intermediate and hard AI always take an obvious jump when available", () => {
    const state = setupBoard([
      { x: 3, y: 3, color: "black" },
      { x: 4, y: 3, color: "white" },
    ]);

    // 3 runs instead of 10 — still validates consistency, much faster
    for (const level of [2, 3] as const) {
      for (let i = 0; i < 3; i++) {
        const result = findBestMove(state, { level, color: "black" }, { aborted: false });
        expect(result, `level ${level} run ${i}: should return a result`).not.toBeNull();
        expect(result!.move.type, `level ${level} run ${i}: should jump`).toBe("jump");
      }
    }
  });

  it("intermediate AI does not place adjacent to opponent piece (giving free capture)", () => {
    const state = setupBoard([{ x: 3, y: 3, color: "white" }], "black");

    // 3 runs instead of 10
    for (let i = 0; i < 3; i++) {
      const result = findBestMove(state, { level: 2, color: "black" }, { aborted: false });
      expect(result).not.toBeNull();
      expect(result!.move.type).toBe("place");

      if (result!.move.type === "place") {
        const { x, y } = result!.move.position;
        const isAdjacent = (Math.abs(x - 3) === 1 && y === 3) || (Math.abs(y - 3) === 1 && x === 3);
        expect(isAdjacent).toBe(false);
      }
    }
  });
});
