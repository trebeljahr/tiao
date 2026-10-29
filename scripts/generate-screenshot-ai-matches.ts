// Generate complete self-play ledgers with the shipped AI and its normal search budgets.
// Run with tsx --tsconfig client/tsconfig.json scripts/generate-screenshot-ai-matches.ts long|compact.
// Generation is explicit; screenshot exports replay the committed ledgers without rerunning search.
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

const id = process.argv[2];
const profiles = {
  long: { boardSize: 19, scoreToWin: 20, white: 3, black: 2 },
  compact: { boardSize: 13, scoreToWin: 15, white: 2, black: 3 },
} as const;
assert(id === "long" || id === "compact", "Choose long or compact");
const profile = profiles[id];
const output = resolve(`scripts/assets/store-screenshots/${id}-match.json`);
mkdirSync(resolve(output, ".."), { recursive: true });
let state = createInitialGameState(profile);
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
  method: `Unmodified shipped engine self-play: White level ${profile.white}, Black level ${profile.black}; normal search budgets; starts at the empty board; every AI decision retained.`,
  boardSize: profile.boardSize,
  scoreToWin: profile.scoreToWin,
  players: {
    white: { level: profile.white, label: profile.white === 3 ? "Hard" : "Intermediate" },
    black: { level: profile.black, label: profile.black === 3 ? "Hard" : "Intermediate" },
  },
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
