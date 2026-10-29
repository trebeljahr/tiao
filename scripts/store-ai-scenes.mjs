// Screenshot boards are prefixes of complete shipped-AI matches, never arranged positions.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  confirmPendingJump,
  createInitialGameState,
  getWinner,
  isGameOver,
  jumpPiece,
  placePiece,
} from "../shared/src/tiao.ts";

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export const boardHash = (state) => sha256(JSON.stringify(state.positions));
export const unwrap = (result) => {
  assert(result.ok, JSON.stringify(result));
  return result.value;
};
export const matchPaths = {
  classic: "scripts/assets/store-trailer/ai-match.json",
  long: "scripts/assets/store-screenshots/long-match.json",
  compact: "scripts/assets/store-screenshots/compact-match.json",
};

export function applyDecision(state, move, confirm = true) {
  assert.equal(state.currentTurn, move.color);
  if (move.type === "place") return unwrap(placePiece(state, move.position));
  assert.equal(move.type, "jump");
  let next = state;
  let from = move.from;
  for (const to of move.path) {
    next = unwrap(jumpPiece(next, from, to));
    from = to;
  }
  return confirm ? unwrap(confirmPendingJump(next)) : next;
}

export function validateMatch(record, engineHash) {
  assert.equal(record.engineSha256, engineHash, "Ledger must use the current shipped AI");
  assert(record.finished, "Only complete matches may supply screenshots");
  const states = [createInitialGameState(record)];
  for (const [turn, move] of record.moves.entries()) {
    const before = states.at(-1);
    assert(!isGameOver(before), "No moves may follow game over");
    assert.equal(move.turn, turn);
    assert.equal(move.level, record.players[before.currentTurn].level);
    assert(move.search.nodes > 0 && move.search.depth > 0, "Missing real AI search result");
    assert.deepEqual(move.scoreBefore, before.score);
    const after = applyDecision(before, move);
    assert.deepEqual(after.score, move.scoreAfter);
    assert.equal(boardHash(after), move.boardSha256);
    states.push(after);
  }
  assert.deepEqual(states.at(-1), record.finalState);
  assert(isGameOver(states.at(-1)));
  assert.equal(getWinner(states.at(-1)), record.winner);
  return states;
}

export function loadMatches() {
  const engineHash = sha256(readFileSync("client/src/lib/engine/tiao-engine.ts"));
  return Object.fromEntries(
    Object.entries(matchPaths).map(([id, path]) => {
      const bytes = readFileSync(path);
      const record = JSON.parse(bytes);
      return [
        id,
        {
          id,
          path,
          ledgerSha256: sha256(bytes),
          record,
          states: validateMatch(record, engineHash),
        },
      ];
    }),
  );
}

const occupied = (state) => state.positions.flat().filter(Boolean).length;
function scene(match, turn) {
  assert(turn >= 20, "Let both AIs develop the game before capturing it");
  const move = match.record.moves[turn];
  const before = match.states[turn];
  return {
    matchId: match.id,
    turn,
    moves: match.record.moves.slice(0, turn),
    move,
    before,
    pending: move.type === "jump" ? applyDecision(before, move, false) : null,
    after: match.states[turn + 1],
  };
}

export function chooseScenes(matches) {
  const developed = matches.long.states
    .map((state, turn) => ({ state, turn }))
    .filter(({ state, turn }) => turn >= 24 && !isGameOver(state))
    .sort((a, b) => occupied(b.state) - occupied(a.state) || b.turn - a.turn)[0];
  assert(developed, "No developed AI position");
  const chains = Object.values(matches).flatMap((match) =>
    match.record.moves
      .map((move, turn) => ({ match, move, turn }))
      .filter(({ move, turn }) => turn >= 20 && move.type === "jump"),
  );
  // Prefer the compact board for a different visual shape; preserve the AI's entire turn.
  const candidates = chains.filter(
    ({ match, turn }) => match.id === "compact" && !isGameOver(match.states[turn + 1]),
  );
  candidates.sort(
    (a, b) =>
      b.move.path.length - a.move.path.length ||
      occupied(b.match.states[b.turn]) - occupied(a.match.states[a.turn]),
  );
  const capture = candidates[0];
  assert(capture, "No compact AI capture available");
  const winningTurn = matches.classic.record.moves.length - 1;
  assert.equal(matches.classic.record.moves[winningTurn].type, "jump");
  return {
    developed: scene(matches.long, developed.turn),
    capture: scene(capture.match, capture.turn),
    victory: scene(matches.classic, winningTurn),
  };
}

export function provenance(match, state, turn, phase = "confirmed") {
  return {
    kind: "shipped AI versus AI; complete match replay",
    matchId: match.id,
    ledger: match.path,
    ledgerSha256: match.ledgerSha256,
    engineSha256: match.record.engineSha256,
    players: match.record.players,
    matchDecisions: match.record.moves.length,
    completedDecisions: turn,
    phase,
    boardSize: state.boardSize,
    scoreToWin: state.scoreToWin,
    score: state.score,
    boardSha256: boardHash(state),
  };
}
