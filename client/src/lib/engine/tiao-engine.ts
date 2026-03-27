import {
  BOARD_SIZE,
  type GameState,
  type Position,
  type PlayerColor,
  otherColor,
  isGameOver,
  getWinner,
  canPlacePiece,
  jumpPiece,
  getJumpTargets,
  getSelectableJumpOrigins,
} from "@shared";

// ─── Types ───────────────────────────────────────────────────────────

export type EngineMove =
  | { type: "place"; position: Position }
  | { type: "jump"; from: Position; path: Position[] };

export type EngineConfig = {
  level: number; // 1-7
  color: PlayerColor;
  onProgress?: (progress: number) => void; // 0-1 fraction of time budget used
};

export type SearchResult = {
  move: EngineMove;
  score: number;
  depth: number;
  nodesSearched: number;
};

type LevelPreset = {
  maxDepth: number;
  timeMs: number;
  evalNoise: number;
  skipProb: number;
  nullMove: boolean;
  quiescence: boolean;
};

type TTFlag = "exact" | "lower" | "upper";

type TTEntry = {
  hash: number;
  depth: number;
  score: number;
  flag: TTFlag;
  bestMoveKey: string | null;
};

type SearchStats = {
  nodes: number;
  ttHits: number;
};

type SearchContext = {
  tt: Map<number, TTEntry>;
  ttMaxSize: number;
  killerMoves: Array<[string | null, string | null]>;
  historyScores: Map<string, number>;
  stats: SearchStats;
  abort: { aborted: boolean };
  preset: LevelPreset;
  startTime: number;
  onProgress?: (progress: number) => void;
  lastProgressReport: number;
};

// ─── Constants ───────────────────────────────────────────────────────

const INF = 100000;
const WIN_SCORE = 50000;
const MAX_QUIESCENCE_DEPTH = 4;
const TT_MAX_SIZE = 65536;
const ABORT_CHECK_INTERVAL = 256;
const MAX_MOVES = 50; // limit moves considered per node to keep search tractable

const LEVEL_PRESETS: LevelPreset[] = [
  { maxDepth: 2, timeMs: 1000, evalNoise: 150, skipProb: 0.3, nullMove: false, quiescence: false },
  { maxDepth: 4, timeMs: 3000, evalNoise: 30, skipProb: 0, nullMove: true, quiescence: true },
  { maxDepth: 6, timeMs: 6000, evalNoise: 0, skipProb: 0, nullMove: true, quiescence: true },
];

export const AI_DIFFICULTY_LABELS: Record<number, string> = {
  1: "Easy",
  2: "Intermediate",
  3: "Hard",
};

const XY_DIRECTIONS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

// ─── Zobrist Hashing ─────────────────────────────────────────────────

const zobristPiece: number[][][] = []; // [y][x][colorIndex] 0=black, 1=white
let zobristSide = 0;

function xorshift32(rng: { v: number }): number {
  let x = rng.v;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  rng.v = x >>> 0;
  return rng.v;
}

(function initZobrist() {
  const rng = { v: 0x12345678 };
  for (let y = 0; y < BOARD_SIZE; y++) {
    zobristPiece[y] = [];
    for (let x = 0; x < BOARD_SIZE; x++) {
      zobristPiece[y][x] = [xorshift32(rng), xorshift32(rng)];
    }
  }
  zobristSide = xorshift32(rng);
})();

export function computeZobristHash(state: GameState): number {
  let hash = state.currentTurn === "black" ? zobristSide : 0;
  for (let y = 0; y < state.boardSize; y++) {
    for (let x = 0; x < state.boardSize; x++) {
      const tile = state.positions[y][x];
      if (tile) {
        hash ^= zobristPiece[y][x][tile === "black" ? 0 : 1];
      }
    }
  }
  hash ^= (state.score.black * 73856093) >>> 0;
  hash ^= (state.score.white * 19349669) >>> 0;
  return hash;
}

// ─── Transposition Table ─────────────────────────────────────────────

function ttProbe(
  ctx: SearchContext,
  hash: number,
  depth: number,
  alpha: number,
  beta: number,
): { score: number | null; bestMoveKey: string | null } {
  const entry = ctx.tt.get(hash);
  if (!entry || entry.hash !== hash) return { score: null, bestMoveKey: null };

  const bestMoveKey = entry.bestMoveKey;

  if (entry.depth >= depth) {
    ctx.stats.ttHits++;
    if (entry.flag === "exact") return { score: entry.score, bestMoveKey };
    if (entry.flag === "lower" && entry.score >= beta)
      return { score: entry.score, bestMoveKey };
    if (entry.flag === "upper" && entry.score <= alpha)
      return { score: entry.score, bestMoveKey };
  }

  return { score: null, bestMoveKey };
}

function ttStore(
  ctx: SearchContext,
  hash: number,
  depth: number,
  score: number,
  flag: TTFlag,
  bestMoveKey: string | null,
): void {
  if (ctx.tt.size >= ctx.ttMaxSize) {
    const firstKey = ctx.tt.keys().next().value;
    if (firstKey !== undefined) ctx.tt.delete(firstKey);
  }
  ctx.tt.set(hash, { hash, depth, score, flag, bestMoveKey });
}

// ─── Move Key ────────────────────────────────────────────────────────

function moveKey(move: EngineMove): string {
  if (move.type === "place") {
    return `p:${move.position.x},${move.position.y}`;
  }
  return `j:${move.from.x},${move.from.y}:${move.path.map((p) => `${p.x},${p.y}`).join(":")}`;
}

// ─── Move Generation ─────────────────────────────────────────────────

function collectJumpChains(
  state: GameState,
  origin: Position,
  current: Position,
  pathSoFar: Position[],
  results: EngineMove[],
): void {
  const targets = getJumpTargets(state, current, state.currentTurn);

  if (targets.length === 0 && pathSoFar.length > 0) {
    // Leaf node: no further jumps possible — this is a complete chain
    results.push({ type: "jump", from: origin, path: [...pathSoFar] });
    return;
  }

  for (const target of targets) {
    const jumped = jumpPiece(state, current, target);
    if (!jumped.ok) continue;
    collectJumpChains(jumped.value, origin, target, [...pathSoFar, target], results);
  }
}

export function generateMoves(
  state: GameState,
  abort?: { aborted: boolean },
): EngineMove[] {
  if (isGameOver(state)) return [];

  const moves: EngineMove[] = [];
  const color = state.currentTurn;

  // Jump moves first (fewer and more impactful)
  const jumpOrigins = getSelectableJumpOrigins(state, color);
  for (const origin of jumpOrigins) {
    collectJumpChains(state, origin, origin, [], moves);
  }

  // Placement moves — prioritize positions near existing stones and center
  const bs = state.boardSize;
  const center = (bs - 1) / 2;
  const placements: Array<{ pos: Position; priority: number }> = [];

  let checked = 0;
  for (let y = 0; y < bs; y++) {
    for (let x = 0; x < bs; x++) {
      // Check abort periodically during the expensive canPlacePiece loop
      if (abort?.aborted) return moves;
      if (state.positions[y][x] !== null) continue;
      const pos = { x, y };
      checked++;
      if (!canPlacePiece(state, pos).ok) continue;

      // Score by adjacency to any stone + center proximity
      let adj = 0;
      for (const { dx, dy } of XY_DIRECTIONS) {
        const nx = x + dx;
        const ny = y + dy;
        if (
          nx >= 0 &&
          nx < bs &&
          ny >= 0 &&
          ny < bs &&
          state.positions[ny][nx] !== null
        ) {
          adj++;
        }
      }
      const dist = Math.abs(x - center) + Math.abs(y - center);
      placements.push({ pos, priority: adj * 100 - dist });
    }
  }

  // Sort placements by priority (adjacent to stones + center preferred)
  placements.sort((a, b) => b.priority - a.priority);
  for (const { pos } of placements) {
    moves.push({ type: "place", position: pos });
  }

  return moves;
}

// ─── Move Application (optimized for search, no history cloning) ─────

export function applyEngineMove(state: GameState, move: EngineMove): GameState {
  if (move.type === "place") {
    const positions = state.positions.map((row) => [...row]);
    positions[move.position.y][move.position.x] = state.currentTurn;
    return {
      boardSize: state.boardSize,
      scoreToWin: state.scoreToWin,
      positions,
      currentTurn: otherColor(state.currentTurn),
      pendingJump: [],
      pendingCaptures: [],
      score: { ...state.score },
      history: state.history,
    };
  }

  const positions = state.positions.map((row) => [...row]);
  const color = state.currentTurn;
  let currentFrom = move.from;
  let captures = 0;

  for (const to of move.path) {
    const middleX = currentFrom.x + (to.x - currentFrom.x) / 2;
    const middleY = currentFrom.y + (to.y - currentFrom.y) / 2;
    positions[currentFrom.y][currentFrom.x] = null;
    positions[to.y][to.x] = color;
    positions[middleY][middleX] = null;
    captures++;
    currentFrom = to;
  }

  const newScore = { ...state.score };
  newScore[color] += captures;

  return {
    boardSize: state.boardSize,
    scoreToWin: state.scoreToWin,
    positions,
    currentTurn: otherColor(color),
    pendingJump: [],
    pendingCaptures: [],
    score: newScore,
    history: state.history,
  };
}

// ─── Evaluation ──────────────────────────────────────────────────────

export function evaluate(state: GameState): number {
  const me = state.currentTurn;
  const opp = otherColor(me);

  if (isGameOver(state)) {
    const winner = getWinner(state);
    if (winner === me) return WIN_SCORE;
    if (winner) return -WIN_SCORE;
    return 0;
  }

  let score = (state.score[me] - state.score[opp]) * 1000;

  let myPieces = 0;
  let oppPieces = 0;
  let myCenterScore = 0;
  let oppCenterScore = 0;
  let myConnections = 0;
  let oppConnections = 0;
  const bs = state.boardSize;
  const center = (bs - 1) / 2;

  for (let y = 0; y < bs; y++) {
    for (let x = 0; x < bs; x++) {
      const tile = state.positions[y][x];
      if (!tile) continue;

      const dist = Math.abs(x - center) + Math.abs(y - center);
      const centerVal = bs - 1 - dist;

      if (tile === me) {
        myPieces++;
        myCenterScore += centerVal;
        for (const { dx, dy } of XY_DIRECTIONS) {
          const nx = x + dx;
          const ny = y + dy;
          if (
            nx >= 0 &&
            nx < bs &&
            ny >= 0 &&
            ny < bs &&
            state.positions[ny][nx] === me
          ) {
            myConnections++;
          }
        }
      } else {
        oppPieces++;
        oppCenterScore += centerVal;
        for (const { dx, dy } of XY_DIRECTIONS) {
          const nx = x + dx;
          const ny = y + dy;
          if (
            nx >= 0 &&
            nx < bs &&
            ny >= 0 &&
            ny < bs &&
            state.positions[ny][nx] === opp
          ) {
            oppConnections++;
          }
        }
      }
    }
  }

  const myJumpOrigins = getSelectableJumpOrigins(state, me).length;
  const oppJumpOrigins = getSelectableJumpOrigins(state, opp).length;

  score += myJumpOrigins * 80 - oppJumpOrigins * 85;
  score += (myPieces - oppPieces) * 3;
  score += (myCenterScore - oppCenterScore) * 2;
  score += (myConnections - oppConnections);

  return score;
}

// ─── Move Ordering ───────────────────────────────────────────────────

function orderMoves(
  moves: EngineMove[],
  depth: number,
  ctx: SearchContext,
  ttBestMoveKey: string | null,
  boardSize: number = BOARD_SIZE,
): EngineMove[] {
  const center = (boardSize - 1) / 2;

  return [...moves].sort((a, b) => {
    const keyA = moveKey(a);
    const keyB = moveKey(b);

    if (keyA === ttBestMoveKey) return -1;
    if (keyB === ttBestMoveKey) return 1;

    // Captures before placements
    if (a.type === "jump" && b.type !== "jump") return -1;
    if (b.type === "jump" && a.type !== "jump") return 1;

    // Longer chains first
    if (a.type === "jump" && b.type === "jump") {
      if (a.path.length !== b.path.length) return b.path.length - a.path.length;
    }

    // Killer moves
    const killers = ctx.killerMoves[depth];
    if (killers) {
      const aIsKiller = keyA === killers[0] || keyA === killers[1];
      const bIsKiller = keyB === killers[0] || keyB === killers[1];
      if (aIsKiller && !bIsKiller) return -1;
      if (bIsKiller && !aIsKiller) return 1;
    }

    // History heuristic
    const histA = ctx.historyScores.get(keyA) ?? 0;
    const histB = ctx.historyScores.get(keyB) ?? 0;
    if (histA !== histB) return histB - histA;

    // Placements: prefer center
    if (a.type === "place" && b.type === "place") {
      const distA =
        Math.abs(a.position.x - center) + Math.abs(a.position.y - center);
      const distB =
        Math.abs(b.position.x - center) + Math.abs(b.position.y - center);
      return distA - distB;
    }

    return 0;
  });
}

function updateKillerMove(
  ctx: SearchContext,
  move: EngineMove,
  depth: number,
): void {
  const key = moveKey(move);
  const killers = ctx.killerMoves[depth];
  if (!killers) return;
  if (killers[0] === key) return;
  killers[1] = killers[0];
  killers[0] = key;
}

function updateHistoryScore(
  ctx: SearchContext,
  move: EngineMove,
  depth: number,
): void {
  const key = moveKey(move);
  const current = ctx.historyScores.get(key) ?? 0;
  ctx.historyScores.set(key, current + depth * depth);
}

// ─── Quiescence Search ──────────────────────────────────────────────

function generateCaptureMoves(state: GameState): EngineMove[] {
  if (isGameOver(state)) return [];
  const moves: EngineMove[] = [];
  const jumpOrigins = getSelectableJumpOrigins(state, state.currentTurn);
  for (const origin of jumpOrigins) {
    collectJumpChains(state, origin, origin, [], moves);
  }
  return moves;
}

function quiescence(
  state: GameState,
  alpha: number,
  beta: number,
  depthLeft: number,
  ctx: SearchContext,
): number {
  ctx.stats.nodes++;

  if (isGameOver(state)) {
    const winner = getWinner(state);
    if (winner === state.currentTurn) return WIN_SCORE;
    if (winner) return -WIN_SCORE;
    return 0;
  }

  const standPat = evaluate(state);
  if (standPat >= beta) return beta;
  if (alpha < standPat) alpha = standPat;
  if (depthLeft <= 0) return alpha;

  const captureMoves = generateCaptureMoves(state);
  captureMoves.sort((a, b) => {
    if (a.type === "jump" && b.type === "jump")
      return b.path.length - a.path.length;
    return 0;
  });

  for (const move of captureMoves) {
    const newState = applyEngineMove(state, move);
    const score = -quiescence(newState, -beta, -alpha, depthLeft - 1, ctx);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }

  return alpha;
}

// ─── Negamax with Alpha-Beta ─────────────────────────────────────────

function negamax(
  state: GameState,
  depth: number,
  alpha: number,
  beta: number,
  hash: number,
  allowNullMove: boolean,
  ctx: SearchContext,
): number {
  ctx.stats.nodes++;

  if (ctx.stats.nodes % ABORT_CHECK_INTERVAL === 0) {
    if (ctx.abort.aborted) return 0;
    const now = performance.now();
    const elapsed = now - ctx.startTime;
    if (elapsed > ctx.preset.timeMs) {
      ctx.abort.aborted = true;
      return 0;
    }
    if (ctx.onProgress && now - ctx.lastProgressReport > 100) {
      ctx.lastProgressReport = now;
      ctx.onProgress(Math.min(1, elapsed / ctx.preset.timeMs));
    }
  }

  if (isGameOver(state)) {
    const winner = getWinner(state);
    if (winner === state.currentTurn) return WIN_SCORE + depth;
    if (winner) return -(WIN_SCORE + depth);
    return 0;
  }

  if (depth <= 0) {
    if (ctx.preset.quiescence) {
      return quiescence(state, alpha, beta, MAX_QUIESCENCE_DEPTH, ctx);
    }
    return evaluate(state);
  }

  // TT probe
  const ttResult = ttProbe(ctx, hash, depth, alpha, beta);
  if (ttResult.score !== null) return ttResult.score;
  const ttBestMoveKey = ttResult.bestMoveKey;

  // Null move pruning
  if (
    allowNullMove &&
    ctx.preset.nullMove &&
    depth >= 3 &&
    state.pendingJump.length === 0
  ) {
    const nullState: GameState = {
      boardSize: state.boardSize,
      scoreToWin: state.scoreToWin,
      positions: state.positions,
      currentTurn: otherColor(state.currentTurn),
      pendingJump: [],
      pendingCaptures: [],
      score: state.score,
      history: state.history,
    };
    const nullHash = hash ^ zobristSide;
    const nullScore = -negamax(
      nullState,
      depth - 3,
      -beta,
      -beta + 1,
      nullHash,
      false,
      ctx,
    );
    if (nullScore >= beta) {
      return beta;
    }
  }

  let moves = generateMoves(state, ctx.abort);
  if (moves.length === 0) return evaluate(state);
  if (ctx.abort.aborted) return 0;

  let orderedMoves = orderMoves(moves, depth, ctx, ttBestMoveKey, state.boardSize);

  // Limit moves at internal nodes to keep search tractable
  if (orderedMoves.length > MAX_MOVES) {
    orderedMoves = orderedMoves.slice(0, MAX_MOVES);
  }

  let bestScore = -INF;
  let bestMoveKey: string | null = null;
  let flag: TTFlag = "upper";

  for (const move of orderedMoves) {
    if (ctx.abort.aborted) return 0;

    const newState = applyEngineMove(state, move);
    const newHash = computeZobristHash(newState);
    const score = -negamax(
      newState,
      depth - 1,
      -beta,
      -alpha,
      newHash,
      true,
      ctx,
    );

    if (score > bestScore) {
      bestScore = score;
      bestMoveKey = moveKey(move);
    }

    if (score > alpha) {
      alpha = score;
      flag = "exact";
    }

    if (alpha >= beta) {
      if (move.type === "place") {
        updateKillerMove(ctx, move, depth);
      }
      updateHistoryScore(ctx, move, depth);
      flag = "lower";
      break;
    }
  }

  ttStore(ctx, hash, depth, bestScore, flag, bestMoveKey);
  return bestScore;
}

// ─── Root Search ─────────────────────────────────────────────────────

function searchRoot(
  state: GameState,
  depth: number,
  ctx: SearchContext,
): SearchResult | null {
  let moves = generateMoves(state, ctx.abort);
  if (moves.length === 0) return null;

  // Lower levels randomly skip some moves
  if (ctx.preset.skipProb > 0) {
    const filtered = moves.filter(() => Math.random() > ctx.preset.skipProb);
    if (filtered.length > 0) moves = filtered;
  }

  const hash = computeZobristHash(state);
  const ttResult = ttProbe(ctx, hash, depth, -INF, INF);
  let orderedMoves = orderMoves(moves, 0, ctx, ttResult.bestMoveKey, state.boardSize);

  // Limit root moves to keep deep searches tractable on open boards
  if (orderedMoves.length > MAX_MOVES) {
    orderedMoves = orderedMoves.slice(0, MAX_MOVES);
  }

  let bestMove = orderedMoves[0];
  let bestScore = -INF;
  let alpha = -INF;

  for (let i = 0; i < orderedMoves.length; i++) {
    const move = orderedMoves[i];
    if (ctx.abort.aborted) break;

    // Report progress based on root move index within current iteration
    if (ctx.onProgress) {
      const elapsed = performance.now() - ctx.startTime;
      ctx.onProgress(Math.min(1, elapsed / ctx.preset.timeMs));
    }

    const newState = applyEngineMove(state, move);
    const newHash = computeZobristHash(newState);
    const score = -negamax(newState, depth - 1, -INF, -alpha, newHash, true, ctx);

    const noisyScore =
      ctx.preset.evalNoise > 0
        ? score + (Math.random() * 2 - 1) * ctx.preset.evalNoise
        : score;

    if (noisyScore > bestScore) {
      bestScore = noisyScore;
      bestMove = move;
    }

    if (score > alpha) alpha = score;
  }

  ttStore(ctx, hash, depth, bestScore, "exact", moveKey(bestMove));

  return {
    move: bestMove,
    score: bestScore,
    depth,
    nodesSearched: ctx.stats.nodes,
  };
}

// ─── Public API ──────────────────────────────────────────────────────

export function findBestMove(
  state: GameState,
  config: EngineConfig,
  abort: { aborted: boolean },
): SearchResult | null {
  if (isGameOver(state)) return null;

  const level = Math.max(1, Math.min(3, config.level));
  const preset = LEVEL_PRESETS[level - 1];

  const ctx: SearchContext = {
    tt: new Map(),
    ttMaxSize: TT_MAX_SIZE,
    killerMoves: Array.from(
      { length: preset.maxDepth + MAX_QUIESCENCE_DEPTH + 10 },
      () => [null, null] as [string | null, string | null],
    ),
    historyScores: new Map(),
    stats: { nodes: 0, ttHits: 0 },
    abort,
    preset,
    startTime: performance.now(),
    onProgress: config.onProgress,
    lastProgressReport: 0,
  };

  let bestResult: SearchResult | null = null;

  for (let depth = 1; depth <= preset.maxDepth; depth++) {
    if (abort.aborted) break;

    const elapsed = performance.now() - ctx.startTime;
    if (elapsed > preset.timeMs * 0.5 && bestResult) break;

    const result = searchRoot(state, depth, ctx);
    if (result) {
      bestResult = result;
    }
  }

  // Fallback: if search was aborted before completing any depth, pick first legal move
  if (!bestResult) {
    const moves = generateMoves(state);
    if (moves.length > 0) {
      bestResult = { move: moves[0], score: 0, depth: 0, nodesSearched: 0 };
    }
  }

  return bestResult;
}
