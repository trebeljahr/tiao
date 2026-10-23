import {
  confirmPendingJump,
  type GameState,
  getJumpTargets,
  getSelectableJumpOrigins,
  getWinner,
  isGameOver,
  jumpPiece,
  type PlayerColor,
  type Position,
  placePiece,
} from "@shared";

export type PuzzleMove =
  | { type: "place"; position: Position }
  | { type: "jump"; from: Position; path: Position[] };

export type PuzzleTurn = { move: PuzzleMove; state: GameState };

/** Every legal complete turn, including voluntarily stopping a chain. */
export function* puzzleTurns(state: GameState): Generator<PuzzleTurn> {
  if (isGameOver(state)) return;
  if (state.pendingJump.length) throw new Error("Puzzle search requires a confirmed turn.");
  for (const origin of getSelectableJumpOrigins(state)) {
    yield* jumpTurns(state, origin, origin, []);
  }
  for (let y = 0; y < state.boardSize; y++) {
    for (let x = 0; x < state.boardSize; x++) {
      if (state.positions[y][x] !== null) continue;
      const result = placePiece(state, { x, y });
      if (result.ok) yield { move: { type: "place", position: { x, y } }, state: result.value };
    }
  }
}

function* jumpTurns(
  state: GameState,
  origin: Position,
  current: Position,
  path: Position[],
): Generator<PuzzleTurn> {
  for (const target of getJumpTargets(state, current)) {
    const jumped = jumpPiece(state, current, target);
    if (!jumped.ok) continue;
    const nextPath = [...path, target];
    const confirmed = confirmPendingJump(jumped.value);
    if (confirmed.ok) {
      yield {
        move: { type: "jump", from: origin, path: nextPath },
        state: confirmed.value,
      };
    }
    yield* jumpTurns(jumped.value, origin, target, nextPath);
  }
}

/** Exact bounded proof. No heuristic scores, move caps, or assumed forced captures. */
export function canForcePuzzleWin(state: GameState, player: PlayerColor, plies: number): boolean {
  if (isGameOver(state)) return getWinner(state) === player;
  if (plies <= 0) return false;
  const playerTurn = state.currentTurn === player;
  let hasMove = false;
  for (const turn of puzzleTurns(state)) {
    hasMove = true;
    const wins = canForcePuzzleWin(turn.state, player, plies - 1);
    if (playerTurn && wins) return true;
    if (!playerTurn && !wins) return false;
  }
  return hasMove && !playerTurn;
}

export function winningPuzzleTurns(state: GameState, plies: number): PuzzleTurn[] {
  return [...puzzleTurns(state)].filter((turn) =>
    canForcePuzzleWin(turn.state, state.currentTurn, plies - 1),
  );
}

export function puzzleMoveKey(move: PuzzleMove): string {
  if (move.type === "place") return `p:${move.position.x},${move.position.y}`;
  return `j:${[move.from, ...move.path].map((p) => `${p.x},${p.y}`).join(":")}`;
}

export function playPuzzleMove(state: GameState, move: PuzzleMove): GameState {
  if (move.type === "place") {
    const result = placePiece(state, move.position);
    if (!result.ok) throw new Error(result.reason);
    return result.value;
  }
  let next = state;
  let from = move.from;
  for (const to of move.path) {
    const result = jumpPiece(next, from, to);
    if (!result.ok) throw new Error(result.reason);
    next = result.value;
    from = to;
  }
  const confirmed = confirmPendingJump(next);
  if (!confirmed.ok) throw new Error(confirmed.reason);
  return confirmed.value;
}

/** Columns A–S (no skipped letters), rows counted down from the top. */
export function puzzleCoordinate(position: Position): string {
  return `${String.fromCharCode(65 + position.x)}${position.y + 1}`;
}

export function describePuzzleMove(move: PuzzleMove): string {
  return move.type === "place"
    ? `Place ${puzzleCoordinate(move.position)}`
    : [move.from, ...move.path].map(puzzleCoordinate).join(" → ");
}
