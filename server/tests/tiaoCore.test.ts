import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  BOARD_SIZE,
  SCORE_TO_WIN,
  canPlacePiece,
  confirmPendingJump,
  createInitialGameState,
  formatPosition,
  formatTurnRecord,
  getSelectableJumpOrigins,
  getWinner,
  isGameOver,
  jumpPiece,
  placePiece,
  replayToMove,
  undoLastTurn,
  undoPendingJumpStep,
} from "../../shared/src";
import { assertRegion, at, serializePositions, stateFromDiagram } from "./boardHarness";

describe("Tiao core rules", () => {
  test("initial state starts on an empty 19x19 board with white to move", () => {
    const state = createInitialGameState();

    assert.equal(state.positions.length, BOARD_SIZE);
    assert.ok(state.positions.every((row) => row.length === BOARD_SIZE));
    assert.equal(state.currentTurn, "white");
    assert.deepEqual(state.score, { black: 0, white: 0 });
    assert.equal(state.history.length, 0);
    assert.equal(state.pendingJump.length, 0);
    assert.equal(state.pendingCaptures.length, 0);
    assert.equal(getWinner(state), null);
    assert.equal(isGameOver(state), false);
  });

  test("border placements are only legal when the opponent could jump into them", () => {
    const allowed = stateFromDiagram(
      `
        . . .
        . W .
        . B .
      `,
      {
        turn: "white",
      }
    );
    const blocked = stateFromDiagram(
      `
        . . .
        . W .
        . . .
      `,
      {
        turn: "white",
      }
    );

    const allowedPlacement = canPlacePiece(allowed, { x: 1, y: 0 });
    assert.equal(allowedPlacement.ok, true);

    const blockedPlacement = canPlacePiece(blocked, { x: 1, y: 0 });
    assert.equal(blockedPlacement.ok, false);
    if (!blockedPlacement.ok) {
      assert.equal(blockedPlacement.code, "INVALID_BORDER");
    }
  });

  test("the cluster rule allows a tenth stone but blocks the eleventh", () => {
    const origin = { x: 4, y: 9 };
    const nineStoneCluster = stateFromDiagram(
      `
        W W W W W W W W W . .
      `,
      {
        origin,
        turn: "white",
      }
    );
    const tenStoneCluster = stateFromDiagram(
      `
        W W W W W W W W W W .
      `,
      {
        origin,
        turn: "white",
      }
    );

    const tenthStone = canPlacePiece(nineStoneCluster, at(origin, 9, 0));
    assert.equal(tenthStone.ok, true);

    const eleventhStone = canPlacePiece(tenStoneCluster, at(origin, 10, 0));
    assert.equal(eleventhStone.ok, false);
    if (!eleventhStone.ok) {
      assert.equal(eleventhStone.code, "INVALID_CLUSTER");
    }
  });

  test("jump chains stay pending until confirmation and then score captured stones", () => {
    const origin = { x: 5, y: 5 };
    const state = stateFromDiagram(
      `
        W . . . . .
        . B . . . .
        . . . . . .
        . . . B . .
        . . . . . .
        . . . . . .
      `,
      {
        origin,
        turn: "white",
      }
    );

    const firstJump = jumpPiece(state, at(origin, 0, 0), at(origin, 2, 2));
    assert.equal(firstJump.ok, true);
    if (!firstJump.ok) {
      return;
    }

    assert.equal(firstJump.value.pendingJump.length, 1);
    assertRegion(
      firstJump.value,
      `
        . . . . . .
        . B . . . .
        . . W . . .
        . . . B . .
        . . . . . .
        . . . . . .
      `,
      { origin }
    );

    const secondJump = jumpPiece(
      firstJump.value,
      at(origin, 2, 2),
      at(origin, 4, 4)
    );
    assert.equal(secondJump.ok, true);
    if (!secondJump.ok) {
      return;
    }

    assert.equal(secondJump.value.pendingJump.length, 2);
    assert.equal(secondJump.value.pendingCaptures.length, 2);
    const lockedOrigins = serializePositions(
      getSelectableJumpOrigins(secondJump.value)
    );
    assert.deepEqual(lockedOrigins, [`${origin.x + 4},${origin.y + 4}`]);

    const pendingPlacement = canPlacePiece(secondJump.value, at(origin, 5, 0));
    assert.equal(pendingPlacement.ok, false);
    if (!pendingPlacement.ok) {
      assert.equal(pendingPlacement.code, "PENDING_JUMP");
    }

    const confirmed = confirmPendingJump(secondJump.value);
    assert.equal(confirmed.ok, true);
    if (!confirmed.ok) {
      return;
    }

    assert.equal(confirmed.value.currentTurn, "black");
    assert.deepEqual(confirmed.value.score, { black: 0, white: 2 });
    assert.equal(confirmed.value.pendingJump.length, 0);
    assert.equal(confirmed.value.pendingCaptures.length, 0);
    assertRegion(
      confirmed.value,
      `
        . . . . . .
        . . . . . .
        . . . . . .
        . . . . . .
        . . . . W .
        . . . . . .
      `,
      { origin }
    );
  });

  test("undoPendingJumpStep only rewinds the most recent hop", () => {
    const origin = { x: 5, y: 5 };
    const state = stateFromDiagram(
      `
        W . . . . .
        . B . . . .
        . . . . . .
        . . . B . .
        . . . . . .
        . . . . . .
      `,
      {
        origin,
        turn: "white",
      }
    );

    const firstJump = jumpPiece(state, at(origin, 0, 0), at(origin, 2, 2));
    assert.equal(firstJump.ok, true);
    if (!firstJump.ok) {
      return;
    }

    const secondJump = jumpPiece(
      firstJump.value,
      at(origin, 2, 2),
      at(origin, 4, 4)
    );
    assert.equal(secondJump.ok, true);
    if (!secondJump.ok) {
      return;
    }

    const undone = undoPendingJumpStep(secondJump.value);
    assert.equal(undone.ok, true);
    if (!undone.ok) {
      return;
    }

    assert.equal(undone.value.pendingJump.length, 1);
    assert.equal(undone.value.pendingCaptures.length, 1);
    assertRegion(
      undone.value,
      `
        . . . . . .
        . B . . . .
        . . W . . .
        . . . B . .
        . . . . . .
        . . . . . .
      `,
      { origin }
    );
  });

  test("getSelectableJumpOrigins lists every capturing piece and locks to the pending jumper", () => {
    const origin = { x: 5, y: 5 };
    const state = stateFromDiagram(
      `
        W . . W . .
        . B . . B .
        . . . . . .
      `,
      {
        origin,
        turn: "white",
      }
    );

    const selectableOrigins = serializePositions(getSelectableJumpOrigins(state));
    assert.deepEqual(selectableOrigins, [
      `${origin.x},${origin.y}`,
      `${origin.x + 3},${origin.y}`,
    ]);

    const jumped = jumpPiece(state, at(origin, 0, 0), at(origin, 2, 2));
    assert.equal(jumped.ok, true);
    if (!jumped.ok) {
      return;
    }

    const lockedOrigins = serializePositions(getSelectableJumpOrigins(jumped.value));
    assert.deepEqual(lockedOrigins, [`${origin.x + 2},${origin.y + 2}`]);
  });

  test("undoLastTurn restores both placed stones and confirmed captures", () => {
    const placed = placePiece(createInitialGameState(), { x: 9, y: 9 });
    assert.equal(placed.ok, true);
    if (!placed.ok) {
      return;
    }

    const undonePlacement = undoLastTurn(placed.value);
    assert.equal(undonePlacement.ok, true);
    if (!undonePlacement.ok) {
      return;
    }

    assert.equal(undonePlacement.value.currentTurn, "white");
    assert.equal(undonePlacement.value.history.length, 0);
    assert.equal(undonePlacement.value.positions[9]?.[9] ?? null, null);

    const origin = { x: 5, y: 5 };
    const jumpState = stateFromDiagram(
      `
        W . . . . .
        . B . . . .
        . . . . . .
        . . . B . .
        . . . . . .
        . . . . . .
      `,
      {
        origin,
        turn: "white",
      }
    );

    const firstJump = jumpPiece(jumpState, at(origin, 0, 0), at(origin, 2, 2));
    assert.equal(firstJump.ok, true);
    if (!firstJump.ok) {
      return;
    }

    const secondJump = jumpPiece(
      firstJump.value,
      at(origin, 2, 2),
      at(origin, 4, 4)
    );
    assert.equal(secondJump.ok, true);
    if (!secondJump.ok) {
      return;
    }

    const confirmed = confirmPendingJump(secondJump.value);
    assert.equal(confirmed.ok, true);
    if (!confirmed.ok) {
      return;
    }

    const undoneJump = undoLastTurn(confirmed.value);
    assert.equal(undoneJump.ok, true);
    if (!undoneJump.ok) {
      return;
    }

    assert.equal(undoneJump.value.currentTurn, "white");
    assert.deepEqual(undoneJump.value.score, { black: 0, white: 0 });
    assert.equal(undoneJump.value.history.length, 0);
    assertRegion(
      undoneJump.value,
      `
        W . . . . .
        . B . . . .
        . . . . . .
        . . . B . .
        . . . . . .
        . . . . . .
      `,
      { origin }
    );
  });

  test("formatPosition converts coordinates to algebraic notation", () => {
    assert.equal(formatPosition({ x: 0, y: 0 }), "a1");
    assert.equal(formatPosition({ x: 18, y: 18 }), "t19");
    assert.equal(formatPosition({ x: 3, y: 5 }), "d6");
    assert.equal(formatPosition({ x: 8, y: 0 }), "j1"); // 'i' is skipped, so h=7, j=8
  });

  test("formatTurnRecord formats put and jump moves", () => {
    const putRecord = formatTurnRecord(
      { type: "put", color: "white", position: { x: 0, y: 0 } },
      0,
    );
    assert.equal(putRecord, "1. W a1");

    const jumpRecord = formatTurnRecord(
      {
        type: "jump",
        color: "black",
        jumps: [
          { from: { x: 3, y: 3 }, over: { x: 4, y: 4 }, to: { x: 5, y: 5 }, color: "black" },
          { from: { x: 5, y: 5 }, over: { x: 6, y: 6 }, to: { x: 7, y: 7 }, color: "black" },
        ],
      },
      1,
    );
    assert.equal(jumpRecord, "2. B d4×f6×h8");
  });

  test("replayToMove reconstructs board state at each move", () => {
    let state = createInitialGameState();

    // White places at (9,9)
    const r1 = placePiece(state, { x: 9, y: 9 });
    assert.equal(r1.ok, true);
    if (!r1.ok) return;
    state = r1.value;

    // Black places at (10,10)
    const r2 = placePiece(state, { x: 10, y: 10 });
    assert.equal(r2.ok, true);
    if (!r2.ok) return;
    state = r2.value;

    // White places at (11,11)
    const r3 = placePiece(state, { x: 11, y: 11 });
    assert.equal(r3.ok, true);
    if (!r3.ok) return;
    state = r3.value;

    const history = state.history;
    assert.equal(history.length, 3);

    // Replay to move 0 — only first placement
    const atMove0 = replayToMove(history, 0);
    assert.equal(atMove0.positions[9][9], "white");
    assert.equal(atMove0.positions[10][10], null);
    assert.equal(atMove0.currentTurn, "black");

    // Replay to move 1
    const atMove1 = replayToMove(history, 1);
    assert.equal(atMove1.positions[9][9], "white");
    assert.equal(atMove1.positions[10][10], "black");
    assert.equal(atMove1.positions[11][11], null);
    assert.equal(atMove1.currentTurn, "white");

    // Replay to last move
    const atMove2 = replayToMove(history, 2);
    assert.equal(atMove2.positions[11][11], "white");
    assert.equal(atMove2.currentTurn, "black");
  });

  test("replayToMove with empty history returns initial state", () => {
    const state = replayToMove([], 0);
    assert.equal(state.currentTurn, "white");
    assert.equal(state.history.length, 0);
  });

  test("replayToMove with negative index returns initial state", () => {
    const history = [
      { type: "put" as const, color: "white" as const, position: { x: 9, y: 9 } },
    ];
    const state = replayToMove(history, -1);
    assert.equal(state.positions[9][9], null);
    assert.equal(state.currentTurn, "white");
  });

  test("game over and illegal jump targets are rejected", () => {
    const gameOverState = stateFromDiagram(
      `
        W . .
        . B .
        . . .
      `,
      {
        turn: "white",
        score: { white: SCORE_TO_WIN },
      }
    );

    const placement = canPlacePiece(gameOverState, { x: 2, y: 2 });
    assert.equal(placement.ok, false);
    if (!placement.ok) {
      assert.equal(placement.code, "GAME_OVER");
    }

    const jumpWhileOver = jumpPiece(
      gameOverState,
      { x: 0, y: 0 },
      { x: 2, y: 2 }
    );
    assert.equal(jumpWhileOver.ok, false);
    if (!jumpWhileOver.ok) {
      assert.equal(jumpWhileOver.code, "GAME_OVER");
    }

    const illegalJumpState = stateFromDiagram(
      `
        W . .
        . W .
        . . .
      `,
      {
        turn: "white",
      }
    );
    const illegalJump = jumpPiece(
      illegalJumpState,
      { x: 0, y: 0 },
      { x: 2, y: 2 }
    );
    assert.equal(illegalJump.ok, false);
    if (!illegalJump.ok) {
      assert.equal(illegalJump.code, "INVALID_JUMP");
    }
  });
});
