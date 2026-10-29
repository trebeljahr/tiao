import { createInitialGameState, type GameState, getWinner, isGameOver } from "@shared";
import { type PuzzleMove, type PuzzleTurn, puzzleTurns, winningPuzzleTurns } from "./puzzleRules";

/** Stable simulation policy. Seeds and plies replay legal games from an empty board. */
export function simulatedGame(seed: number): Generator<GameState> {
  return simulate(seed);
}

function* simulate(seed: number): Generator<GameState> {
  let bits = seed || 1;
  const random = () => {
    bits ^= bits << 13;
    bits ^= bits >>> 17;
    bits ^= bits << 5;
    return (bits >>> 0) / 4294967296;
  };
  const captureBias = [0.55, 0.65, 0.75][seed % 3];
  let state = createInitialGameState({ boardSize: 9, scoreToWin: 10 });
  for (let ply = 0; ply < 180 && !isGameOver(state); ply++) {
    yield state;
    const turns = [...puzzleTurns(state)];
    if (!turns.length) return;
    const jumps = turns.filter((turn) => turn.move.type === "jump");
    const placements = turns.filter((turn) => turn.move.type === "place");
    const pool =
      jumps.length && (!placements.length || random() < captureBias) ? jumps : placements;
    state = pool[Math.floor(random() * pool.length)].state;
  }
}

/** Ignore scores and normalize side-to-move, rotations and reflections when deduplicating. */
export function canonicalPuzzleBoard(state: GameState): string {
  const variants: string[] = [];
  for (let reflected = 0; reflected < 2; reflected++) {
    for (let rotation = 0; rotation < 4; rotation++) {
      const cells = Array<string>(state.boardSize ** 2).fill(".");
      for (let y = 0; y < state.boardSize; y++) {
        for (let x = 0; x < state.boardSize; x++) {
          let nx = reflected ? state.boardSize - 1 - x : x;
          let ny = y;
          for (let r = 0; r < rotation; r++) [nx, ny] = [state.boardSize - 1 - ny, nx];
          const color = state.positions[y][x];
          cells[ny * state.boardSize + nx] =
            color === null ? "." : color === state.currentTurn ? "P" : "O";
        }
      }
      variants.push(cells.join(""));
    }
  }
  return variants.sort()[0];
}

export type GeneratedPuzzleRecord = {
  player: GameState["currentTurn"];
  score: GameState["score"];
  rows: string[];
  turns: 1 | 2;
  line: PuzzleMove[];
  source: { seed: number; ply: number };
};

export function recordPuzzle(
  state: GameState,
  answer: PuzzleTurn,
  turns: 1 | 2,
  source: GeneratedPuzzleRecord["source"],
): GeneratedPuzzleRecord {
  const line = [answer.move];
  if (turns === 2) {
    // Prefer a defence that makes the solver work hardest on the final turn.
    let reply: PuzzleTurn | undefined;
    let continuations: PuzzleTurn[] = [];
    for (const defence of puzzleTurns(answer.state)) {
      const wins = winningPuzzleTurns(defence.state, 1);
      if (getWinner(defence.state) || !wins.length) throw new Error("Unproved reply");
      if (!reply || wins.length < continuations.length) {
        reply = defence;
        continuations = wins;
      }
    }
    if (!reply) throw new Error("Missing defence");
    line.push(reply.move, continuations[0].move);
  }
  return {
    player: state.currentTurn,
    score: { ...state.score },
    rows: state.positions.map((row) =>
      row.map((cell) => (cell === null ? "." : cell === "white" ? "W" : "B")).join(""),
    ),
    turns,
    line,
    source,
  };
}
