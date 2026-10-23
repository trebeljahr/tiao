import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  confirmPendingJump,
  createInitialGameState,
  getWinner,
  jumpPiece,
  placePiece,
} from "../shared/src/tiao.ts";

const match = JSON.parse(readFileSync("scripts/assets/store-trailer/ai-match.json", "utf8"));
const unwrap = (r) => {
  assert(r.ok, JSON.stringify(r));
  return r.value;
};
test("medium versus hard match contains a complete, unedited legal replay", () => {
  let state = createInitialGameState();
  assert.equal(match.players.white.level, 2);
  assert.equal(match.players.black.level, 3);
  for (const [turn, move] of match.moves.entries()) {
    assert.equal(move.turn, turn);
    assert.equal(move.color, state.currentTurn);
    assert.deepEqual(move.scoreBefore, state.score);
    assert(move.search.nodes > 0 && move.search.depth > 0);
    if (move.type === "place") state = unwrap(placePiece(state, move.position));
    else {
      let from = move.from;
      for (const to of move.path) {
        state = unwrap(jumpPiece(state, from, to));
        from = to;
      }
      state = unwrap(confirmPendingJump(state));
    }
    assert.deepEqual(move.scoreAfter, state.score);
    assert.equal(
      createHash("sha256").update(JSON.stringify(state.positions)).digest("hex"),
      move.boardSha256,
    );
  }
  assert.deepEqual(state.positions, match.finalState.positions);
  assert.deepEqual(state.score, match.finalState.score);
  assert.equal(getWinner(state), match.winner);
  assert.equal(match.finished, true);
});
test("White capture is followed by a legal Black double reply", () => {
  let s = createInitialGameState();
  for (const p of [
    { x: 9, y: 9 },
    { x: 10, y: 10 },
    { x: 11, y: 9 },
    { x: 10, y: 8 },
  ])
    s = unwrap(placePiece(s, p));
  s = unwrap(jumpPiece(s, { x: 9, y: 9 }, { x: 11, y: 11 }));
  s = unwrap(confirmPendingJump(s));
  assert.equal(s.currentTurn, "black");
  s = unwrap(jumpPiece(s, { x: 10, y: 8 }, { x: 12, y: 10 }));
  s = unwrap(jumpPiece(s, { x: 12, y: 10 }, { x: 10, y: 12 }));
  assert.equal(s.pendingCaptures.length, 2);
  s = unwrap(confirmPendingJump(s));
  assert.deepEqual(s.score, { white: 1, black: 2 });
});
