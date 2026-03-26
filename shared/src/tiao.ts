export const BOARD_SIZE = 19;
export const SCORE_TO_WIN = 10;

export type PlayerColor = "black" | "white";
export type TileState = PlayerColor | null;

export type Position = {
  x: number;
  y: number;
};

export type JumpStep = {
  from: Position;
  over: Position;
  to: Position;
  color: PlayerColor;
};

export type PutTurn = {
  type: "put";
  position: Position;
  color: PlayerColor;
  timestamp?: number;
};

export type JumpTurn = {
  type: "jump";
  color: PlayerColor;
  jumps: JumpStep[];
  timestamp?: number;
};

export type ForfeitTurn = {
  type: "forfeit";
  color: PlayerColor;
  reason?: "forfeit" | "timeout";
};

export type WinTurn = {
  type: "win";
  color: PlayerColor;
};

export type TurnRecord = PutTurn | JumpTurn | ForfeitTurn | WinTurn;

/** Records that represent actual board moves (not meta-events like forfeit/win) */
export function isBoardMove(record: TurnRecord): record is PutTurn | JumpTurn {
  return record.type === "put" || record.type === "jump";
}

export type ScoreState = Record<PlayerColor, number>;

export type GameState = {
  positions: TileState[][];
  currentTurn: PlayerColor;
  pendingJump: JumpStep[];
  pendingCaptures: Position[];
  score: ScoreState;
  history: TurnRecord[];
};

export type RuleFailureCode =
  | "GAME_OVER"
  | "OUT_OF_BOUNDS"
  | "OCCUPIED"
  | "PENDING_JUMP"
  | "INVALID_CLUSTER"
  | "INVALID_BORDER"
  | "NO_PIECE"
  | "NOT_YOUR_PIECE"
  | "INVALID_JUMP"
  | "NO_PENDING_JUMP";

export type RuleResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      code: RuleFailureCode;
      reason: string;
    };

const XY_DIRECTIONS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
] as const;

const ALL_DIRECTIONS = [
  ...XY_DIRECTIONS,
  { dx: 1, dy: 1 },
  { dx: -1, dy: -1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: 1 },
] as const;

const ALL_JUMP_DIRECTIONS = ALL_DIRECTIONS.map(({ dx, dy }) => ({
  dx: dx * 2,
  dy: dy * 2,
}));

function createEmptyBoard(): TileState[][] {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => null)
  );
}

function clonePosition(position: Position): Position {
  return { x: position.x, y: position.y };
}

function cloneJumpStep(jump: JumpStep): JumpStep {
  return {
    from: clonePosition(jump.from),
    over: clonePosition(jump.over),
    to: clonePosition(jump.to),
    color: jump.color,
  };
}

function cloneHistoryRecord(record: TurnRecord): TurnRecord {
  if (record.type === "put") {
    return {
      type: "put",
      color: record.color,
      position: clonePosition(record.position),
      ...(record.timestamp != null ? { timestamp: record.timestamp } : {}),
    };
  }

  if (record.type === "forfeit") {
    return {
      type: "forfeit",
      color: record.color,
      ...(record.reason ? { reason: record.reason } : {}),
    };
  }

  if (record.type === "win") {
    return { type: "win", color: record.color };
  }

  return {
    type: "jump",
    color: record.color,
    jumps: record.jumps.map(cloneJumpStep),
    ...(record.timestamp != null ? { timestamp: record.timestamp } : {}),
  };
}

export function cloneGameState(state: GameState): GameState {
  return {
    positions: state.positions.map((row) => [...row]),
    currentTurn: state.currentTurn,
    pendingJump: state.pendingJump.map(cloneJumpStep),
    pendingCaptures: state.pendingCaptures.map(clonePosition),
    score: { ...state.score },
    history: state.history.map(cloneHistoryRecord),
  };
}

export function createInitialGameState(): GameState {
  return {
    positions: createEmptyBoard(),
    currentTurn: "white",
    pendingJump: [],
    pendingCaptures: [],
    score: {
      black: 0,
      white: 0,
    },
    history: [],
  };
}

export function otherColor(color: PlayerColor): PlayerColor {
  return color === "white" ? "black" : "white";
}

export function isInBounds(position: Position): boolean {
  return (
    position.x >= 0 &&
    position.x < BOARD_SIZE &&
    position.y >= 0 &&
    position.y < BOARD_SIZE
  );
}

export function arePositionsEqual(a: Position | null, b: Position | null): boolean {
  if (!a || !b) {
    return false;
  }

  return a.x === b.x && a.y === b.y;
}

export function getTile(state: GameState, position: Position): TileState {
  return state.positions[position.y]?.[position.x] ?? null;
}

export function isGameOver(state: GameState): boolean {
  if (state.score.black >= SCORE_TO_WIN || state.score.white >= SCORE_TO_WIN) {
    return true;
  }
  return state.history.some((r) => r.type === "win");
}

export function getWinner(state: GameState): PlayerColor | null {
  if (state.score.black >= SCORE_TO_WIN) {
    return "black";
  }

  if (state.score.white >= SCORE_TO_WIN) {
    return "white";
  }

  const winRecord = state.history.find((r) => r.type === "win");
  if (winRecord) {
    return winRecord.color;
  }

  return null;
}

export function forfeitGame(
  state: GameState,
  forfeitingColor: PlayerColor,
  reason: "forfeit" | "timeout" = "forfeit",
): RuleResult<GameState> {
  if (isGameOver(state)) {
    return {
      ok: false,
      code: "GAME_OVER",
      reason: "The game is already over.",
    };
  }

  const winnerColor = otherColor(forfeitingColor);
  const nextState = cloneGameState(state);
  nextState.pendingJump = [];
  nextState.pendingCaptures = [];
  nextState.history.push({
    type: "forfeit",
    color: forfeitingColor,
    reason,
  });
  nextState.history.push({
    type: "win",
    color: winnerColor,
  });

  return { ok: true, value: nextState };
}

export function getPendingJumpDestination(state: GameState): Position | null {
  return state.pendingJump[state.pendingJump.length - 1]?.to ?? null;
}

export function isPositionMarkedForCapture(
  state: GameState,
  position: Position
): boolean {
  return state.pendingCaptures.some(
    (capture) => capture.x === position.x && capture.y === position.y
  );
}

export function findConnectedCluster(
  state: GameState,
  start: Position,
  targetColor: TileState = getTile(state, start)
): Position[] {
  if (!targetColor) {
    return [];
  }

  const visited = new Set<string>();
  const cluster: Position[] = [];
  const stack = [clonePosition(start)];

  while (stack.length > 0) {
    const current = stack.pop();

    if (!current) {
      continue;
    }

    const key = `${current.x},${current.y}`;
    if (visited.has(key)) {
      continue;
    }

    visited.add(key);

    if (getTile(state, current) !== targetColor) {
      continue;
    }

    cluster.push(current);

    for (const { dx, dy } of XY_DIRECTIONS) {
      const next = {
        x: current.x + dx,
        y: current.y + dy,
      };

      if (isInBounds(next) && !visited.has(`${next.x},${next.y}`)) {
        stack.push(next);
      }
    }
  }

  return cluster;
}

export function getJumpTargets(
  state: GameState,
  from: Position,
  color: PlayerColor = getTile(state, from) as PlayerColor
): Position[] {
  if (!color) {
    return [];
  }

  const paths: Position[] = [];

  for (const { dx, dy } of ALL_JUMP_DIRECTIONS) {
    const middle = {
      x: from.x + dx / 2,
      y: from.y + dy / 2,
    };

    const destination = {
      x: from.x + dx,
      y: from.y + dy,
    };

    if (!isInBounds(middle) || !isInBounds(destination)) {
      continue;
    }

    const middlePiece = getTile(state, middle);
    if (
      middlePiece === null ||
      middlePiece === color ||
      isPositionMarkedForCapture(state, middle)
    ) {
      continue;
    }

    if (getTile(state, destination) === null) {
      paths.push(destination);
    }
  }

  return paths;
}

function positionOnTopEdge(position: Position): boolean {
  return position.y === 0;
}

function positionOnBottomEdge(position: Position): boolean {
  return position.y === BOARD_SIZE - 1;
}

function positionOnLeftEdge(position: Position): boolean {
  return position.x === 0;
}

function positionOnRightEdge(position: Position): boolean {
  return position.x === BOARD_SIZE - 1;
}

export function isBorderPosition(position: Position): boolean {
  return (
    positionOnTopEdge(position) ||
    positionOnBottomEdge(position) ||
    positionOnLeftEdge(position) ||
    positionOnRightEdge(position)
  );
}

function positionCouldBeJumpedByEnemy(
  state: GameState,
  position: Position
): boolean {
  for (const { dx, dy } of ALL_JUMP_DIRECTIONS) {
    const jumpingPosition = {
      x: position.x + dx,
      y: position.y + dy,
    };

    const middle = {
      x: position.x + dx / 2,
      y: position.y + dy / 2,
    };

    if (!isInBounds(jumpingPosition) || !isInBounds(middle)) {
      continue;
    }

    const middlePiece = getTile(state, middle);
    const jumpingPiece = getTile(state, jumpingPosition);

    if (
      middlePiece !== state.currentTurn ||
      isPositionMarkedForCapture(state, middle)
    ) {
      continue;
    }

    if (jumpingPiece && jumpingPiece !== state.currentTurn) {
      return true;
    }

    if (jumpingPiece === null) {
      const recursiveState = cloneGameState(state);
      recursiveState.pendingCaptures.push(clonePosition(middle));

      if (positionCouldBeJumpedByEnemy(recursiveState, jumpingPosition)) {
        return true;
      }
    }
  }

  return false;
}

function violatesClusterRule(state: GameState, position: Position): boolean {
  for (const { dx, dy } of XY_DIRECTIONS) {
    const adjacent = {
      x: position.x + dx,
      y: position.y + dy,
    };

    if (!isInBounds(adjacent)) {
      continue;
    }

    if (getTile(state, adjacent) !== state.currentTurn) {
      continue;
    }

    const adjacentCluster = findConnectedCluster(
      state,
      adjacent,
      state.currentTurn
    );

    if (adjacentCluster.length >= 10) {
      return true;
    }
  }

  return false;
}

function violatesBorderRule(state: GameState, position: Position): boolean {
  if (!isBorderPosition(position)) {
    return false;
  }

  return !positionCouldBeJumpedByEnemy(state, position);
}

export function canPlacePiece(state: GameState, position: Position): RuleResult<true> {
  if (isGameOver(state)) {
    return {
      ok: false,
      code: "GAME_OVER",
      reason: "The game is already over.",
    };
  }

  if (!isInBounds(position)) {
    return {
      ok: false,
      code: "OUT_OF_BOUNDS",
      reason: "That move is outside the board.",
    };
  }

  if (state.pendingJump.length > 0) {
    return {
      ok: false,
      code: "PENDING_JUMP",
      reason: "You need to finish the current jump sequence first.",
    };
  }

  if (getTile(state, position) !== null) {
    return {
      ok: false,
      code: "OCCUPIED",
      reason: "That point is already occupied.",
    };
  }

  if (violatesClusterRule(state, position)) {
    return {
      ok: false,
      code: "INVALID_CLUSTER",
      reason: "That placement would violate the cluster rule.",
    };
  }

  if (violatesBorderRule(state, position)) {
    return {
      ok: false,
      code: "INVALID_BORDER",
      reason: "That border placement is not allowed.",
    };
  }

  return {
    ok: true,
    value: true,
  };
}

export function placePiece(
  state: GameState,
  position: Position
): RuleResult<GameState> {
  const placementCheck = canPlacePiece(state, position);
  if (!placementCheck.ok) {
    return placementCheck;
  }

  const nextState = cloneGameState(state);
  nextState.positions[position.y][position.x] = nextState.currentTurn;
  nextState.history.push({
    type: "put",
    color: nextState.currentTurn,
    position: clonePosition(position),
  });
  nextState.currentTurn = otherColor(nextState.currentTurn);
  nextState.pendingJump = [];
  nextState.pendingCaptures = [];

  return {
    ok: true,
    value: nextState,
  };
}

export function canJumpFrom(
  state: GameState,
  from: Position
): RuleResult<true> {
  if (isGameOver(state)) {
    return {
      ok: false,
      code: "GAME_OVER",
      reason: "The game is already over.",
    };
  }

  if (!isInBounds(from)) {
    return {
      ok: false,
      code: "OUT_OF_BOUNDS",
      reason: "That move is outside the board.",
    };
  }

  const tile = getTile(state, from);

  if (!tile) {
    return {
      ok: false,
      code: "NO_PIECE",
      reason: "There is no piece at that position.",
    };
  }

  if (tile !== state.currentTurn) {
    return {
      ok: false,
      code: "NOT_YOUR_PIECE",
      reason: "That piece does not belong to the current player.",
    };
  }

  if (state.pendingJump.length > 0) {
    const pendingDestination = getPendingJumpDestination(state);
    if (!arePositionsEqual(pendingDestination, from)) {
      return {
        ok: false,
        code: "PENDING_JUMP",
        reason: "You need to continue jumping with the same piece.",
      };
    }
  }

  return {
    ok: true,
    value: true,
  };
}

export function jumpPiece(
  state: GameState,
  from: Position,
  to: Position
): RuleResult<GameState> {
  const jumpCheck = canJumpFrom(state, from);
  if (!jumpCheck.ok) {
    return jumpCheck;
  }

  if (!isInBounds(to)) {
    return {
      ok: false,
      code: "OUT_OF_BOUNDS",
      reason: "That move is outside the board.",
    };
  }

  if (getTile(state, to) !== null) {
    return {
      ok: false,
      code: "OCCUPIED",
      reason: "That destination is already occupied.",
    };
  }

  const legalTargets = getJumpTargets(state, from, state.currentTurn);
  const targetIsLegal = legalTargets.some((target) => arePositionsEqual(target, to));

  if (!targetIsLegal) {
    return {
      ok: false,
      code: "INVALID_JUMP",
      reason: "That jump is not legal from the current board state.",
    };
  }

  const middle = {
    x: from.x + (to.x - from.x) / 2,
    y: from.y + (to.y - from.y) / 2,
  };

  const nextState = cloneGameState(state);
  nextState.positions[from.y][from.x] = null;
  nextState.positions[to.y][to.x] = state.currentTurn;
  nextState.pendingCaptures.push(clonePosition(middle));
  nextState.pendingJump.push({
    from: clonePosition(from),
    to: clonePosition(to),
    over: clonePosition(middle),
    color: state.currentTurn,
  });

  return {
    ok: true,
    value: nextState,
  };
}

export function confirmPendingJump(state: GameState): RuleResult<GameState> {
  if (state.pendingJump.length === 0) {
    return {
      ok: false,
      code: "NO_PENDING_JUMP",
      reason: "There is no jump sequence to confirm.",
    };
  }

  if (isGameOver(state)) {
    return {
      ok: false,
      code: "GAME_OVER",
      reason: "The game is already over.",
    };
  }

  const nextState = cloneGameState(state);

  for (const captured of nextState.pendingCaptures) {
    const capturedPiece = nextState.positions[captured.y][captured.x];
    if (capturedPiece === "white") {
      nextState.score.black += 1;
    } else if (capturedPiece === "black") {
      nextState.score.white += 1;
    }

    nextState.positions[captured.y][captured.x] = null;
  }

  nextState.history.push({
    type: "jump",
    color: state.currentTurn,
    jumps: nextState.pendingJump.map(cloneJumpStep),
  });

  // Check if this capture wins the game
  if (nextState.score[state.currentTurn] >= SCORE_TO_WIN) {
    nextState.history.push({
      type: "win",
      color: state.currentTurn,
    });
  }

  nextState.pendingJump = [];
  nextState.pendingCaptures = [];
  nextState.currentTurn = otherColor(state.currentTurn);

  return {
    ok: true,
    value: nextState,
  };
}

export function undoPendingJumpStep(state: GameState): RuleResult<GameState> {
  if (state.pendingJump.length === 0) {
    return {
      ok: false,
      code: "NO_PENDING_JUMP",
      reason: "There is no pending jump to undo.",
    };
  }

  const nextState = cloneGameState(state);
  const lastJump = nextState.pendingJump.pop();
  nextState.pendingCaptures.pop();

  if (!lastJump) {
    return {
      ok: false,
      code: "NO_PENDING_JUMP",
      reason: "There is no pending jump to undo.",
    };
  }

  nextState.positions[lastJump.from.y][lastJump.from.x] = lastJump.color;
  nextState.positions[lastJump.to.y][lastJump.to.x] = null;

  return {
    ok: true,
    value: nextState,
  };
}

export function undoLastTurn(state: GameState): RuleResult<GameState> {
  if (state.pendingJump.length > 0) {
    return {
      ok: false,
      code: "PENDING_JUMP",
      reason: "Finish the current jump sequence before undoing the last turn.",
    };
  }

  const lastTurn = state.history[state.history.length - 1];
  if (!lastTurn) {
    return {
      ok: true,
      value: cloneGameState(state),
    };
  }

  if (lastTurn.type === "forfeit") {
    return {
      ok: false,
      code: "GAME_OVER",
      reason: "Cannot undo a forfeit.",
    };
  }

  if (lastTurn.type === "win") {
    return {
      ok: false,
      code: "GAME_OVER",
      reason: "Cannot undo a win.",
    };
  }

  const nextState = cloneGameState(state);
  nextState.history.pop();

  // Also pop a trailing win record if present (win follows the winning move)
  if (nextState.history.length > 0 && nextState.history[nextState.history.length - 1].type === "win") {
    nextState.history.pop();
  }

  if (lastTurn.type === "put") {
    nextState.positions[lastTurn.position.y][lastTurn.position.x] = null;
    nextState.currentTurn = lastTurn.color;

    return {
      ok: true,
      value: nextState,
    };
  }

  for (const jump of [...lastTurn.jumps].reverse()) {
    nextState.positions[jump.from.y][jump.from.x] = jump.color;
    nextState.positions[jump.over.y][jump.over.x] = otherColor(jump.color);
    nextState.positions[jump.to.y][jump.to.x] = null;
  }

  nextState.score[lastTurn.color] = Math.max(
    0,
    nextState.score[lastTurn.color] - lastTurn.jumps.length
  );
  nextState.currentTurn = lastTurn.color;

  return {
    ok: true,
    value: nextState,
  };
}

export function getSelectableJumpOrigins(
  state: GameState,
  color: PlayerColor = state.currentTurn
): Position[] {
  if (state.pendingJump.length > 0) {
    const destination = getPendingJumpDestination(state);
    return destination ? [destination] : [];
  }

  const origins: Position[] = [];

  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const position = { x, y };
      if (getTile(state, position) !== color) {
        continue;
      }

      if (getJumpTargets(state, position, color).length > 0) {
        origins.push(position);
      }
    }
  }

  return origins;
}

const POSITION_LETTERS = "abcdefghjklmnopqrst";

export function formatPosition(pos: Position): string {
  const letter = POSITION_LETTERS[pos.x] ?? "?";
  const number = pos.y + 1;
  return `${letter}${number}`;
}

export function formatTurnRecord(record: TurnRecord, index: number): string {
  const moveNumber = index + 1;
  const colorInitial = record.color === "white" ? "W" : "B";

  if (record.type === "forfeit") {
    const label = record.reason === "timeout" ? "timeout" : "forfeit";
    return `${moveNumber}. ${colorInitial} ${label}`;
  }

  if (record.type === "win") {
    return `${moveNumber}. ${colorInitial} wins`;
  }

  if (record.type === "put") {
    return `${moveNumber}. ${colorInitial} ${formatPosition(record.position)}`;
  }

  const positions = [
    formatPosition(record.jumps[0].from),
    ...record.jumps.map((j) => formatPosition(j.to)),
  ];
  return `${moveNumber}. ${colorInitial} ${positions.join("×")}`;
}

export function replayToMove(
  history: TurnRecord[],
  moveIndex: number,
): GameState {
  let state = createInitialGameState();
  const end = Math.min(moveIndex + 1, history.length);

  for (let i = 0; i < end; i++) {
    const record = history[i];

    if (record.type === "win") {
      // Win records are meta-events; the board state doesn't change
      continue;
    } else if (record.type === "forfeit") {
      const result = forfeitGame(state, record.color, record.reason ?? "forfeit");
      if (result.ok) {
        state = result.value;
      }
    } else if (record.type === "put") {
      const result = placePiece(state, record.position);
      if (result.ok) {
        state = result.value;
      }
    } else {
      for (const jump of record.jumps) {
        const jumpResult = jumpPiece(state, jump.from, jump.to);
        if (jumpResult.ok) {
          state = jumpResult.value;
        }
      }
      const confirmResult = confirmPendingJump(state);
      if (confirmResult.ok) {
        state = confirmResult.value;
      }
    }
  }

  return state;
}

