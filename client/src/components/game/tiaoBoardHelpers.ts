import {
  BOARD_SIZE,
  type GameState,
  type Position,
  type RuleFailureCode,
  type TurnRecord,
} from "@shared";
import type { BoardTheme } from "./boardThemes";

export type LastMoveHighlight = TurnRecord | null;

export function gridMetrics(bs: number) {
  const gridStart = 100 / (bs * 2);
  const gridEnd = 100 - gridStart;
  const gridSpan = gridEnd - gridStart;
  const gridStep = gridSpan / (bs - 1);
  return { gridStart, gridEnd, gridSpan, gridStep };
}

const DEFAULT_METRICS = gridMetrics(BOARD_SIZE);
export const GRID_START = DEFAULT_METRICS.gridStart;
export const GRID_STEP = DEFAULT_METRICS.gridStep;

export const DRAG_THRESHOLD = 10;
export const DRAG_Y_OFFSET = 4; // grid cells to offset above finger during drag

// Maps placement-path RuleFailureCodes to translation keys. Codes not listed
// (NO_PIECE/NOT_YOUR_PIECE/INVALID_JUMP/NO_PENDING_JUMP/OUT_OF_BOUNDS) shouldn't
// fire from an empty-cell click, but fall back to a generic toast so a future
// rule-engine change doesn't silently swallow the feedback.
export const PLACEMENT_ERROR_KEYS: Partial<Record<RuleFailureCode, string>> = {
  GAME_OVER: "gameOverToast",
  OCCUPIED: "occupiedToast",
  PENDING_JUMP: "pendingJumpToast",
  INVALID_CLUSTER: "invalidClusterToast",
  INVALID_BORDER: "invalidBorderToast",
};

export function getStarPoints(bs: number): number[] {
  if (bs === 19) return [3, 9, 15];
  if (bs === 13) return [3, 6, 9];
  if (bs === 9) return [2, 4, 6];
  return [];
}

export function isStarPoint(position: Position, bs: number) {
  const starPointIndices = getStarPoints(bs);
  return starPointIndices.includes(position.x) && starPointIndices.includes(position.y);
}

export function pointPercent(index: number, gs: number = GRID_START, gst: number = GRID_STEP) {
  return gs + gst * index;
}

export function getPositionKey(position: Position) {
  return `${position.x}-${position.y}`;
}

// Border + background for a "ghost" stone preview. Both the desktop hover
// ghost and the mobile-preview loupe share the same valid/invalid + turn
// colour selection — pulled out so the two callers can't drift apart.
export function getGhostStoneColors(
  theme: BoardTheme,
  valid: boolean,
  turn: GameState["currentTurn"],
) {
  if (!valid) {
    return { borderColor: theme.invalidPieceBorder, background: theme.invalidPieceBg };
  }
  return turn === "black"
    ? { borderColor: theme.blackPieceBorder, background: theme.blackPieceBg }
    : { borderColor: theme.whitePieceBorder, background: theme.whitePieceBg };
}

export function touchToGridPosition(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  boardSize: number = BOARD_SIZE,
): Position {
  const m = gridMetrics(boardSize);
  const percentX = ((clientX - rect.left) / rect.width) * 100;
  const percentY = ((clientY - rect.top) / rect.height) * 100;
  const gridX = Math.round((percentX - m.gridStart) / m.gridStep);
  const gridY = Math.round((percentY - m.gridStart) / m.gridStep);
  return {
    x: Math.max(0, Math.min(boardSize - 1, gridX)),
    y: Math.max(0, Math.min(boardSize - 1, gridY)),
  };
}

// True if `pos` has at least one occupied 4-neighbor AND the touch point
// landed farther than 60% of a grid step from the snapped intersection
// center. In that case the tap was probably aimed at the adjacent piece,
// so handleTouchEnd should bail and let the underlying button onClick
// (with its larger hit area) take the event.
export function isFatFingerNearAdjacentPiece(
  pos: Position,
  touchClientX: number,
  touchClientY: number,
  rect: DOMRect,
  positions: GameState["positions"],
  bs: number,
  m: ReturnType<typeof gridMetrics>,
  pp: (index: number) => number,
) {
  const adjacent: Array<[number, number]> = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  const hasAdjacent = adjacent.some(([ox, oy]) => {
    const nx = pos.x + ox;
    const ny = pos.y + oy;
    return nx >= 0 && nx < bs && ny >= 0 && ny < bs && positions[ny]?.[nx] != null;
  });
  if (!hasAdjacent) return false;
  const touchPctX = ((touchClientX - rect.left) / rect.width) * 100;
  const touchPctY = ((touchClientY - rect.top) / rect.height) * 100;
  const distToSnap = Math.hypot(touchPctX - pp(pos.x), touchPctY - pp(pos.y));
  return distToSnap > m.gridStep * 0.6;
}

export function getJumpTrailMetrics(
  from: Position,
  to: Position,
  pp: (index: number) => number = pointPercent,
) {
  const startX = pp(from.x);
  const startY = pp(from.y);
  const endX = pp(to.x);
  const endY = pp(to.y);
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const distance = Math.hypot(deltaX, deltaY);

  if (distance === 0) {
    return {
      startX,
      startY,
      endX,
      endY,
      centerX: startX,
      centerY: startY,
      distance: 0,
      angle: 0,
    };
  }

  const unitX = deltaX / distance;
  const unitY = deltaY / distance;
  const startInset = 0.7;
  const endInset = 1.1;
  const segmentStartX = startX + unitX * startInset;
  const segmentStartY = startY + unitY * startInset;
  const segmentEndX = endX - unitX * endInset;
  const segmentEndY = endY - unitY * endInset;
  const segmentDeltaX = segmentEndX - segmentStartX;
  const segmentDeltaY = segmentEndY - segmentStartY;
  const segmentDistance = Math.hypot(segmentDeltaX, segmentDeltaY);

  return {
    startX: segmentStartX,
    startY: segmentStartY,
    endX: segmentEndX,
    endY: segmentEndY,
    centerX: (segmentStartX + segmentEndX) / 2,
    centerY: (segmentStartY + segmentEndY) / 2,
    distance: segmentDistance,
    angle: (Math.atan2(segmentDeltaY, segmentDeltaX) * 180) / Math.PI,
  };
}
