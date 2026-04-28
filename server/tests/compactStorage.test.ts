import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  compactToHistory,
  createInitialGameState,
  historyToCompact,
  placePiece,
  positionsToSparse,
  sparseToPositions,
  type TileState,
  type TurnRecord,
} from "../../shared/src";

describe("positionsToSparse / sparseToPositions", () => {
  test("empty board round-trips", () => {
    const size = 9;
    const empty: TileState[][] = Array.from({ length: size }, () =>
      Array.from({ length: size }, () => null),
    );
    const sparse = positionsToSparse(empty);
    assert.deepEqual(sparse, { white: [], black: [] });

    const restored = sparseToPositions(sparse, size);
    assert.deepEqual(restored, empty);
  });

  test("board with stones round-trips", () => {
    const size = 5;
    const board: TileState[][] = Array.from({ length: size }, () =>
      Array.from({ length: size }, () => null),
    );
    board[0][1] = "white";
    board[2][3] = "black";
    board[4][4] = "white";
    board[3][0] = "black";

    const sparse = positionsToSparse(board);
    assert.deepEqual(sparse.white, [
      [1, 0],
      [4, 4],
    ]);
    assert.deepEqual(sparse.black, [
      [3, 2],
      [0, 3],
    ]);

    const restored = sparseToPositions(sparse, size);
    assert.deepEqual(restored, board);
  });

  test("19x19 board round-trips through a real game state", () => {
    let state = createInitialGameState();
    const r1 = placePiece(state, { x: 9, y: 9 });
    assert.ok(r1.ok);
    state = r1.value;
    const r2 = placePiece(state, { x: 10, y: 10 });
    assert.ok(r2.ok);
    state = r2.value;

    const sparse = positionsToSparse(state.positions);
    const restored = sparseToPositions(sparse, state.boardSize);
    assert.deepEqual(restored, state.positions);
  });
});

describe("historyToCompact / compactToHistory", () => {
  test("empty history round-trips", () => {
    const history: TurnRecord[] = [];
    const compact = historyToCompact(history);
    assert.deepEqual(compact, { m: [] });

    const restored = compactToHistory(compact);
    assert.deepEqual(restored, history);
  });

  test("put turns round-trip with correct colors", () => {
    const history: TurnRecord[] = [
      { type: "put", color: "white", position: { x: 9, y: 9 } },
      { type: "put", color: "black", position: { x: 10, y: 10 } },
      { type: "put", color: "white", position: { x: 5, y: 3 } },
    ];
    const compact = historyToCompact(history);
    assert.deepEqual(compact.m, [
      [9, 9],
      [10, 10],
      [5, 3],
    ]);
    assert.equal(compact.t, undefined); // no timestamps

    const restored = compactToHistory(compact);
    assert.deepEqual(restored, history);
  });

  test("put turns with timestamps round-trip", () => {
    const history: TurnRecord[] = [
      { type: "put", color: "white", position: { x: 9, y: 9 }, timestamp: 1000 },
      { type: "put", color: "black", position: { x: 10, y: 10 }, timestamp: 2000 },
    ];
    const compact = historyToCompact(history);
    assert.deepEqual(compact.t, [1000, 2000]);

    const restored = compactToHistory(compact);
    assert.deepEqual(restored, history);
  });

  test("jump turns round-trip with derived over positions", () => {
    const history: TurnRecord[] = [
      { type: "put", color: "white", position: { x: 9, y: 9 } },
      { type: "put", color: "black", position: { x: 10, y: 10 } },
      {
        type: "jump",
        color: "white",
        jumps: [
          { from: { x: 8, y: 8 }, over: { x: 9, y: 9 }, to: { x: 10, y: 10 }, color: "white" },
        ],
      },
    ];
    const compact = historyToCompact(history);
    // Jump encoded as [fromX, fromY, toX, toY]
    assert.deepEqual(compact.m[2], [8, 8, 10, 10]);

    const restored = compactToHistory(compact);
    assert.deepEqual(restored, history);
  });

  test("multi-hop jump round-trips", () => {
    const history: TurnRecord[] = [
      {
        type: "jump",
        color: "white",
        jumps: [
          { from: { x: 0, y: 0 }, over: { x: 1, y: 1 }, to: { x: 2, y: 2 }, color: "white" },
          { from: { x: 2, y: 2 }, over: { x: 3, y: 3 }, to: { x: 4, y: 4 }, color: "white" },
          { from: { x: 4, y: 4 }, over: { x: 5, y: 3 }, to: { x: 6, y: 2 }, color: "white" },
        ],
      },
    ];
    const compact = historyToCompact(history);
    assert.deepEqual(compact.m[0], [0, 0, 2, 2, 4, 4, 6, 2]);

    const restored = compactToHistory(compact);
    assert.deepEqual(restored, history);
  });

  test("win record round-trips", () => {
    const history: TurnRecord[] = [
      { type: "put", color: "white", position: { x: 9, y: 9 } },
      { type: "win", color: "white" },
    ];
    const compact = historyToCompact(history);
    assert.deepEqual(compact.m, [[9, 9], "w:white"]);

    const restored = compactToHistory(compact);
    assert.deepEqual(restored, history);
  });

  test("draw record round-trips", () => {
    const history: TurnRecord[] = [
      { type: "put", color: "white", position: { x: 9, y: 9 } },
      { type: "draw" },
    ];
    const compact = historyToCompact(history);
    assert.deepEqual(compact.m, [[9, 9], "d"]);

    const restored = compactToHistory(compact);
    assert.deepEqual(restored, history);
  });

  test("forfeit record round-trips", () => {
    const history: TurnRecord[] = [
      { type: "forfeit", color: "black", reason: "forfeit" },
      { type: "win", color: "white" },
    ];
    const compact = historyToCompact(history);
    assert.deepEqual(compact.m, ["f:black", "w:white"]);

    const restored = compactToHistory(compact);
    assert.deepEqual(restored, history);
  });

  test("timeout forfeit round-trips", () => {
    const history: TurnRecord[] = [
      { type: "forfeit", color: "white", reason: "timeout" },
      { type: "win", color: "black" },
    ];
    const compact = historyToCompact(history);
    assert.deepEqual(compact.m, ["t:white", "w:black"]);

    const restored = compactToHistory(compact);
    assert.deepEqual(restored, history);
  });

  test("meta events do not affect turn color derivation", () => {
    const history: TurnRecord[] = [
      { type: "put", color: "white", position: { x: 9, y: 9 } },
      { type: "win", color: "white" },
      // If we hypothetically continued after a win, next board move would be black
    ];
    const compact = historyToCompact(history);
    const restored = compactToHistory(compact);
    assert.equal(restored[0].type, "put");
    if (restored[0].type === "put") {
      assert.equal(restored[0].color, "white");
    }
  });

  test("full game round-trips through actual gameplay", () => {
    let state = createInitialGameState();

    // White puts at 9,9
    let r = placePiece(state, { x: 9, y: 9 });
    assert.ok(r.ok);
    state = r.value;

    // Black puts at 10,10
    r = placePiece(state, { x: 10, y: 10 });
    assert.ok(r.ok);
    state = r.value;

    // White puts at 8,8
    r = placePiece(state, { x: 8, y: 8 });
    assert.ok(r.ok);
    state = r.value;

    const compact = historyToCompact(state.history);
    const restored = compactToHistory(compact);
    assert.deepEqual(restored, state.history);
  });

  test("timestamps are omitted when none present", () => {
    const history: TurnRecord[] = [{ type: "put", color: "white", position: { x: 0, y: 0 } }];
    const compact = historyToCompact(history);
    assert.equal(compact.t, undefined);
  });

  test("timestamps array includes nulls for meta events", () => {
    const history: TurnRecord[] = [
      { type: "put", color: "white", position: { x: 9, y: 9 }, timestamp: 5000 },
      { type: "win", color: "white" },
    ];
    const compact = historyToCompact(history);
    assert.ok(compact.t);
    assert.deepEqual(compact.t, [5000, null]);
  });
});
