// Run the shipped medium/hard engine, then validate each decision through public rules.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type EngineMove, findBestMove } from "../client/src/lib/engine/tiao-engine";
import {
  confirmPendingJump,
  createInitialGameState,
  type GameState,
  getWinner,
  isGameOver,
  jumpPiece,
  type PlayerColor,
  placePiece,
  type RuleResult,
} from "../shared/src/tiao";

const output = resolve(process.argv[2] || "build/store-trailer-v9/ai-match.json");
mkdirSync(resolve(output, ".."), { recursive: true });
let state = createInitialGameState();
type RecordedMove = EngineMove & {
  color: PlayerColor;
  turn: number;
  level: number;
  search: { score: number; depth: number; nodes: number; elapsedMs: number };
  scoreBefore: GameState["score"];
  scoreAfter: GameState["score"];
  boardSha256: string;
};
const moves: RecordedMove[] = [];
const unwrap = (r: RuleResult<GameState>) => {
  assert(r.ok, JSON.stringify(r));
  return r.value;
};
const record = {
  finished: false,
  winner: null as PlayerColor | null,
  finalState: state,
  method:
    "Unmodified shipped engine self-play: White Intermediate (level 2), Black Hard (level 3); normal search budgets; no scripted moves or seeded board.",
  boardSize: 19,
  scoreToWin: 10,
  players: { white: { level: 2, label: "Intermediate" }, black: { level: 3, label: "Hard" } },
  engineSha256: createHash("sha256")
    .update(readFileSync("client/src/lib/engine/tiao-engine.ts"))
    .digest("hex"),
  moves,
};
for (let turn = 0; turn < 300 && !isGameOver(state); turn++) {
  const color = state.currentTurn,
    level = record.players[color].level,
    start = performance.now();
  const result = findBestMove(state, { level, color }, { aborted: false });
  assert(result, "Engine returned no decision before termination");
  const move = {
    ...result.move,
    color,
    turn,
    level,
    search: {
      score: result.score,
      depth: result.depth,
      nodes: result.nodesSearched,
      elapsedMs: Math.round(performance.now() - start),
    },
    scoreBefore: { ...state.score },
  };
  if (move.type === "place") state = unwrap(placePiece(state, move.position));
  else {
    let from = move.from;
    for (const to of move.path) {
      state = unwrap(jumpPiece(state, from, to));
      from = to;
    }
    state = unwrap(confirmPendingJump(state));
  }
  moves.push({
    ...move,
    scoreAfter: { ...state.score },
    boardSha256: createHash("sha256").update(JSON.stringify(state.positions)).digest("hex"),
  });
  Object.assign(record, {
    finished: isGameOver(state),
    winner: getWinner(state),
    finalState: state,
  });
  writeFileSync(output, JSON.stringify(record, null, 2) + "\n");
  console.log(
    JSON.stringify({
      turn: turn + 1,
      color,
      type: move.type,
      path: move.type === "jump" ? move.path.length : undefined,
      depth: result.depth,
      score: state.score,
      ms: move.search.elapsedMs,
    }),
  );
}
assert(isGameOver(state), "Match exceeded 300 turns");
assert(getWinner(state), "The match ended without a winner");
console.log(
  "MATCH COMPLETE " +
    JSON.stringify({ turns: moves.length, winner: getWinner(state), score: state.score }),
);
