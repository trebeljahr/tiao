/** Lightweight game engine for tutorial mini-boards (parameterized board size). */

export type Cell = "W" | "B" | null;
export type Pos = { x: number; y: number };

export type JumpRecord = { from: Pos; to: Pos; over: Pos };

const ALL_DIRS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: 1 },
  { dx: -1, dy: -1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: 1 },
] as const;

const ORTHO_DIRS = ALL_DIRS.slice(0, 4);

export function inBounds(p: Pos, size: number): boolean {
  return p.x >= 0 && p.x < size && p.y >= 0 && p.y < size;
}

export function posEq(a: Pos, b: Pos): boolean {
  return a.x === b.x && a.y === b.y;
}

export function makeBoard(size: number): Cell[][] {
  return Array.from({ length: size }, () => Array(size).fill(null) as Cell[]);
}

export function cloneBoard(board: Cell[][]): Cell[][] {
  return board.map((row) => [...row]);
}

export function otherColor(c: "W" | "B"): "W" | "B" {
  return c === "W" ? "B" : "W";
}

export function getJumpTargets(
  board: Cell[][],
  from: Pos,
  color: "W" | "B",
  size: number,
  pendingCaptures: Pos[] = [],
): Pos[] {
  const enemy = otherColor(color);
  const targets: Pos[] = [];

  for (const d of ALL_DIRS) {
    const mid: Pos = { x: from.x + d.dx, y: from.y + d.dy };
    const to: Pos = { x: from.x + d.dx * 2, y: from.y + d.dy * 2 };

    if (!inBounds(to, size)) continue;
    if (board[mid.y][mid.x] !== enemy) continue;
    if (pendingCaptures.some((c) => posEq(c, mid))) continue;
    if (board[to.y][to.x] !== null) continue;

    targets.push(to);
  }

  return targets;
}

export function findCluster(board: Cell[][], start: Pos, size: number): Pos[] {
  const color = board[start.y][start.x];
  if (!color) return [];

  const visited = new Set<string>();
  const cluster: Pos[] = [];
  const stack: Pos[] = [start];

  while (stack.length > 0) {
    const p = stack.pop()!;
    const key = `${p.x},${p.y}`;
    if (visited.has(key)) continue;
    visited.add(key);
    cluster.push(p);

    for (const d of ORTHO_DIRS) {
      const n: Pos = { x: p.x + d.dx, y: p.y + d.dy };
      if (inBounds(n, size) && board[n.y][n.x] === color && !visited.has(`${n.x},${n.y}`)) {
        stack.push(n);
      }
    }
  }

  return cluster;
}

/**
 * Cluster rule: you can't place next to a cluster that already has 10+ stones.
 * Merging two smaller clusters into >10 IS allowed (only extending a big one is blocked).
 * This matches the real game engine's violatesClusterRule.
 */
export function violatesClusterRule(
  board: Cell[][],
  pos: Pos,
  color: "W" | "B",
  size: number,
  maxCluster = 10,
): boolean {
  for (const d of ORTHO_DIRS) {
    const adj: Pos = { x: pos.x + d.dx, y: pos.y + d.dy };
    if (!inBounds(adj, size)) continue;
    if (board[adj.y][adj.x] !== color) continue;

    const cluster = findCluster(board, adj, size);
    if (cluster.length >= maxCluster) {
      return true; // Adjacent cluster already at max — can't extend it
    }
  }
  return false;
}

export function isBorderPos(pos: Pos, size: number): boolean {
  return pos.x === 0 || pos.y === 0 || pos.x === size - 1 || pos.y === size - 1;
}

/**
 * Recursive check: could an enemy chain-jump to reach this position?
 * Mirrors the real game's positionCouldBeJumpedByEnemy.
 * Enemy jumps over `color` pieces. If a jump origin is empty, recursively check
 * if an enemy could reach that origin via further jumps.
 */
function positionReachableByEnemy(
  board: Cell[][],
  pos: Pos,
  color: "W" | "B",
  size: number,
  pendingCaptures: Pos[] = [],
  depth = 0,
): boolean {
  if (depth > 6) return false; // prevent infinite recursion

  const enemy = otherColor(color);

  for (const d of ALL_DIRS) {
    const mid: Pos = { x: pos.x + d.dx, y: pos.y + d.dy };
    const from: Pos = { x: pos.x + d.dx * 2, y: pos.y + d.dy * 2 };

    if (!inBounds(from, size) || !inBounds(mid, size)) continue;

    const midPiece = board[mid.y][mid.x];
    // Middle must be current player's piece (enemy jumps over it)
    if (midPiece !== color) continue;
    // Middle must not already be marked for capture
    if (pendingCaptures.some((c) => posEq(c, mid))) continue;

    const fromPiece = board[from.y][from.x];
    // If there's an enemy piece at the jump origin, it can jump here
    if (fromPiece === enemy) return true;

    // If the jump origin is empty, check recursively if enemy can reach it
    if (fromPiece === null) {
      const newCaptures = [...pendingCaptures, mid];
      if (positionReachableByEnemy(board, from, color, size, newCaptures, depth + 1)) {
        return true;
      }
    }
  }

  return false;
}

export function isBorderBlocked(
  board: Cell[][],
  pos: Pos,
  color: "W" | "B",
  size: number,
): boolean {
  if (!isBorderPos(pos, size)) return false;
  return !positionReachableByEnemy(board, pos, color, size);
}

/** Full placement validity check. */
export function canPlacePiece(
  board: Cell[][],
  pos: Pos,
  color: "W" | "B",
  size: number,
): { ok: true } | { ok: false; reason: string } {
  if (!inBounds(pos, size)) return { ok: false, reason: "Out of bounds" };
  if (board[pos.y][pos.x] !== null) return { ok: false, reason: "Occupied" };
  if (violatesClusterRule(board, pos, color, size)) {
    return { ok: false, reason: "That cluster already has 10 — can't add more!" };
  }
  if (isBorderBlocked(board, pos, color, size)) {
    return { ok: false, reason: "No enemy can reach this edge spot!" };
  }
  return { ok: true };
}

/** Get all pieces of a given color that have at least one jump target. */
export function getSelectableJumpOrigins(
  board: Cell[][],
  color: "W" | "B",
  size: number,
  pendingCaptures: Pos[] = [],
): Pos[] {
  const origins: Pos[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (board[y][x] !== color) continue;
      if (getJumpTargets(board, { x, y }, color, size, pendingCaptures).length > 0) {
        origins.push({ x, y });
      }
    }
  }
  return origins;
}
