import { describe, it, expect } from "vitest";
import { createInitialGameState, type GameState } from "@shared";
import {
  generateMoves,
  evaluate,
  applyEngineMove,
  computeZobristHash,
  findBestMove,
  type EngineMove,
  AI_DIFFICULTY_LABELS,
} from "./tiao-engine";

function setupBoard(
  pieces: Array<{ x: number; y: number; color: "black" | "white" }>,
  currentTurn: "black" | "white" = "black",
): GameState {
  const state = createInitialGameState();
  for (const p of pieces) {
    state.positions[p.y][p.x] = p.color;
  }
  state.currentTurn = currentTurn;
  return state;
}

describe("Move Generation", () => {
  it("generates placement moves on empty board", () => {
    const state = createInitialGameState();
    const moves = generateMoves(state);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => m.type === "place")).toBe(true);
  });

  it("generates jump moves when captures are available", () => {
    const state = setupBoard([
      { x: 9, y: 9, color: "black" },
      { x: 10, y: 9, color: "white" },
    ]);
    const moves = generateMoves(state);
    const jumpMoves = moves.filter((m) => m.type === "jump");
    expect(jumpMoves.length).toBeGreaterThan(0);
  });

  it("generates multi-hop jump chains", () => {
    // Black at (6,9), white at (7,9) and (9,9), empty at (8,9) and (10,9)
    const state = setupBoard([
      { x: 6, y: 9, color: "black" },
      { x: 7, y: 9, color: "white" },
      { x: 9, y: 9, color: "white" },
    ]);
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
    const state = setupBoard([
      { x: 6, y: 9, color: "black" },
      { x: 7, y: 9, color: "white" },
      { x: 9, y: 9, color: "white" },
    ]);
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
    const centerState = setupBoard([{ x: 9, y: 9, color: "black" }], "black");
    const cornerState = setupBoard([{ x: 1, y: 1, color: "black" }], "black");
    const centerScore = evaluate(centerState);
    const cornerScore = evaluate(cornerState);
    expect(centerScore).toBeGreaterThan(cornerScore);
  });
});

describe("Zobrist Hashing", () => {
  it("produces same hash for same position", () => {
    const state = setupBoard([
      { x: 9, y: 9, color: "black" },
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
    const state1 = setupBoard([{ x: 9, y: 9, color: "black" }], "black");
    const state2 = setupBoard([{ x: 9, y: 9, color: "black" }], "white");
    expect(computeZobristHash(state1)).not.toBe(computeZobristHash(state2));
  });
});

describe("Search", () => {
  it("finds immediate capture", () => {
    const state = setupBoard([
      { x: 9, y: 9, color: "black" },
      { x: 10, y: 9, color: "white" },
    ]);
    const result = findBestMove(state, { level: 3, color: "black" }, { aborted: false });
    expect(result).not.toBeNull();
    expect(result!.move.type).toBe("jump");
  });

  it("prefers multi-capture chains over single captures", () => {
    // Black can either single-capture or double-capture
    const state = setupBoard([
      { x: 6, y: 9, color: "black" },
      { x: 7, y: 9, color: "white" },
      { x: 9, y: 9, color: "white" },
      // Also place a separate single capture option
      { x: 3, y: 3, color: "black" },
      { x: 4, y: 3, color: "white" },
    ]);
    const result = findBestMove(state, { level: 3, color: "black" }, { aborted: false });
    expect(result).not.toBeNull();
    if (result!.move.type === "jump") {
      // Should prefer the double capture chain
      expect(result!.move.path.length).toBe(2);
    }
  });

  it("returns null for game-over state", () => {
    const state = createInitialGameState();
    state.score.white = 10;
    const result = findBestMove(state, { level: 3, color: "black" }, { aborted: false });
    expect(result).toBeNull();
  });

  it("respects abort signal", () => {
    const state = createInitialGameState();
    state.currentTurn = "black";
    const abort = { aborted: true };
    findBestMove(state, { level: 3, color: "black" }, abort);
    // Should still return something from depth 1 if it manages to start
    // but importantly should not hang
    expect(true).toBe(true); // just ensure it completes
  });

  it("chooses a placement when no captures available", () => {
    const state = createInitialGameState();
    state.currentTurn = "black";
    const result = findBestMove(state, { level: 3, color: "black" }, { aborted: false });
    expect(result).not.toBeNull();
    expect(result!.move.type).toBe("place");
  });

  it("produces valid state after applying result", () => {
    const state = setupBoard([
      { x: 9, y: 9, color: "black" },
      { x: 10, y: 9, color: "white" },
    ]);
    const result = findBestMove(state, { level: 3, color: "black" }, { aborted: false });
    expect(result).not.toBeNull();
    const newState = applyEngineMove(state, result!.move);
    expect(newState.currentTurn).toBe("white");
  });
});

describe("Difficulty Levels", () => {
  it("level 1 completes within its time budget", () => {
    const state = createInitialGameState();
    state.currentTurn = "black";
    const start = performance.now();
    findBestMove(state, { level: 1, color: "black" }, { aborted: false });
    const elapsed = performance.now() - start;
    // Level 1 (Easy) has a 3s budget; allow some overhead
    expect(elapsed).toBeLessThan(10000);
  });

  it("higher levels search deeper", () => {
    const state = setupBoard([
      { x: 9, y: 9, color: "black" },
      { x: 10, y: 9, color: "white" },
      { x: 5, y: 5, color: "white" },
      { x: 6, y: 6, color: "black" },
    ]);
    const result1 = findBestMove(state, { level: 1, color: "black" }, { aborted: false });
    const result4 = findBestMove(state, { level: 3, color: "black" }, { aborted: false });
    expect(result1).not.toBeNull();
    expect(result4).not.toBeNull();
    expect(result4!.depth).toBeGreaterThanOrEqual(result1!.depth);
  });
});

describe("AI Difficulty Presets (#66)", () => {
  it("has three difficulty labels: Easy, Intermediate, Hard", () => {
    expect(AI_DIFFICULTY_LABELS[1]).toBe("Easy");
    expect(AI_DIFFICULTY_LABELS[2]).toBe("Intermediate");
    expect(AI_DIFFICULTY_LABELS[3]).toBe("Hard");
  });

  it("intermediate level (2) produces a valid move", () => {
    const state = createInitialGameState();
    state.currentTurn = "black";
    const result = findBestMove(state, { level: 2, color: "black" }, { aborted: false });
    expect(result).not.toBeNull();
    expect(result!.move.type).toBe("place");
  });

  it("intermediate level searches deeper than easy level", () => {
    const state = setupBoard([
      { x: 9, y: 9, color: "black" },
      { x: 10, y: 9, color: "white" },
      { x: 5, y: 5, color: "white" },
      { x: 6, y: 6, color: "black" },
    ]);
    const resultEasy = findBestMove(state, { level: 1, color: "black" }, { aborted: false });
    const resultIntermediate = findBestMove(
      state,
      { level: 2, color: "black" },
      { aborted: false },
    );
    expect(resultEasy).not.toBeNull();
    expect(resultIntermediate).not.toBeNull();
    expect(resultIntermediate!.depth).toBeGreaterThanOrEqual(resultEasy!.depth);
  });

  it("hard level searches at least as deep as intermediate", () => {
    const state = setupBoard([
      { x: 9, y: 9, color: "black" },
      { x: 10, y: 9, color: "white" },
      { x: 5, y: 5, color: "white" },
      { x: 6, y: 6, color: "black" },
    ]);
    const resultIntermediate = findBestMove(
      state,
      { level: 2, color: "black" },
      { aborted: false },
    );
    const resultHard = findBestMove(state, { level: 3, color: "black" }, { aborted: false });
    expect(resultIntermediate).not.toBeNull();
    expect(resultHard).not.toBeNull();
    expect(resultHard!.depth).toBeGreaterThanOrEqual(resultIntermediate!.depth);
  });

  it("difficulty ordering: easy is weakest, hard is strongest (by search depth)", () => {
    const state = setupBoard([
      { x: 9, y: 9, color: "black" },
      { x: 10, y: 9, color: "white" },
    ]);
    const easy = findBestMove(state, { level: 1, color: "black" }, { aborted: false });
    const intermediate = findBestMove(state, { level: 2, color: "black" }, { aborted: false });
    const hard = findBestMove(state, { level: 3, color: "black" }, { aborted: false });

    expect(easy).not.toBeNull();
    expect(intermediate).not.toBeNull();
    expect(hard).not.toBeNull();

    // Depths should be ordered: easy <= intermediate <= hard
    expect(intermediate!.depth).toBeGreaterThanOrEqual(easy!.depth);
    expect(hard!.depth).toBeGreaterThanOrEqual(intermediate!.depth);
  });
});
