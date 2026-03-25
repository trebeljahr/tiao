import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  BOARD_SIZE,
  GameState,
  Position,
  TurnRecord,
  arePositionsEqual,
  getPendingJumpDestination,
  getSelectableJumpOrigins,
  isPositionMarkedForCapture,
} from "@shared";
import { cn } from "@/lib/utils";

export type LastMoveHighlight = TurnRecord | null;

type TiaoBoardProps = {
  state: GameState;
  selectedPiece: Position | null;
  jumpTargets: Position[];
  disabled?: boolean;
  confirmReady?: boolean;
  lastMove?: LastMoveHighlight;
  onPointClick: (position: Position) => void;
  onUndoLastJump?: () => void;
};

const GRID_START = 100 / (BOARD_SIZE * 2);
const GRID_END = 100 - GRID_START;
const GRID_SPAN = GRID_END - GRID_START;
const GRID_STEP = GRID_SPAN / (BOARD_SIZE - 1);

const IS_TOUCH_DEVICE =
  typeof window !== "undefined" &&
  ("ontouchstart" in window || navigator.maxTouchPoints > 0);

const LOUPE_ACTIVATION_MS = 120;
const LOUPE_SIZE = 120;
const LOUPE_OFFSET_Y = 80;
const LOUPE_ZOOM = 3;
const DRAG_THRESHOLD = 10;

function isStarPoint(position: Position) {
  const starPointIndices = [3, 9, 15];
  return (
    starPointIndices.includes(position.x) && starPointIndices.includes(position.y)
  );
}

function pointPercent(index: number) {
  return GRID_START + GRID_STEP * index;
}

function getPositionKey(position: Position) {
  return `${position.x}-${position.y}`;
}

export function touchToGridPosition(
  clientX: number,
  clientY: number,
  rect: DOMRect
): Position {
  const percentX = ((clientX - rect.left) / rect.width) * 100;
  const percentY = ((clientY - rect.top) / rect.height) * 100;
  const gridX = Math.round((percentX - GRID_START) / GRID_STEP);
  const gridY = Math.round((percentY - GRID_START) / GRID_STEP);
  return {
    x: Math.max(0, Math.min(BOARD_SIZE - 1, gridX)),
    y: Math.max(0, Math.min(BOARD_SIZE - 1, gridY)),
  };
}

function getJumpTrailMetrics(from: Position, to: Position) {
  const startX = pointPercent(from.x);
  const startY = pointPercent(from.y);
  const endX = pointPercent(to.x);
  const endY = pointPercent(to.y);
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

function LoupeBubble({
  position,
  screenX,
  screenY,
  boardRect,
  state,
}: {
  position: Position;
  screenX: number;
  screenY: number;
  boardRect: DOMRect;
  state: GameState;
}) {
  const centerX = pointPercent(position.x);
  const centerY = pointPercent(position.y);
  const loupeR = (GRID_STEP * LOUPE_ZOOM) / 2;

  // Position relative to board container
  let left = screenX - boardRect.left;
  let top = screenY - boardRect.top - LOUPE_OFFSET_Y;

  // If too close to top edge, show below the finger instead
  if (top - LOUPE_SIZE / 2 < 0) {
    top = screenY - boardRect.top + LOUPE_OFFSET_Y;
  }

  // Clamp horizontally within board bounds
  left = Math.max(LOUPE_SIZE / 2, Math.min(boardRect.width - LOUPE_SIZE / 2, left));

  const stoneColor = state.currentTurn;

  return (
    <div
      className="pointer-events-none absolute z-[100]"
      style={{
        left,
        top,
        transform: "translate(-50%, -50%)",
      }}
    >
      <div
        className="overflow-hidden rounded-full border-[3px] border-[#b89a64] shadow-[0_8px_32px_rgba(0,0,0,0.35),inset_0_1px_2px_rgba(255,255,255,0.3)]"
        style={{ width: LOUPE_SIZE, height: LOUPE_SIZE }}
      >
        <svg
          viewBox={`${centerX - loupeR} ${centerY - loupeR} ${loupeR * 2} ${loupeR * 2}`}
          width={LOUPE_SIZE}
          height={LOUPE_SIZE}
          className="bg-[#dfc48c]"
        >
          {/* Board background */}
          <rect
            x={centerX - loupeR}
            y={centerY - loupeR}
            width={loupeR * 2}
            height={loupeR * 2}
            fill="#dfc48c"
          />

          {/* Grid lines */}
          {Array.from({ length: BOARD_SIZE }, (_, index) => {
            const coordinate = pointPercent(index);
            return (
              <g key={index}>
                <line
                  x1={GRID_START}
                  y1={coordinate}
                  x2={GRID_END}
                  y2={coordinate}
                  stroke="#6c4926"
                  strokeWidth="0.46"
                  strokeLinecap="square"
                />
                <line
                  x1={coordinate}
                  y1={GRID_START}
                  x2={coordinate}
                  y2={GRID_END}
                  stroke="#6c4926"
                  strokeWidth="0.46"
                  strokeLinecap="square"
                />
              </g>
            );
          })}

          {/* Star points */}
          {Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) => {
            const pos = {
              x: index % BOARD_SIZE,
              y: Math.floor(index / BOARD_SIZE),
            };
            if (!isStarPoint(pos)) return null;
            return (
              <circle
                key={`loupe-star-${pos.x}-${pos.y}`}
                cx={pointPercent(pos.x)}
                cy={pointPercent(pos.y)}
                r={0.55}
                fill="#573615"
              />
            );
          })}

          {/* Existing stones */}
          {Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) => {
            const pos = {
              x: index % BOARD_SIZE,
              y: Math.floor(index / BOARD_SIZE),
            };
            const piece = state.positions[pos.y][pos.x];
            if (!piece) return null;

            const cx = pointPercent(pos.x);
            const cy = pointPercent(pos.y);
            const stoneR = GRID_STEP * 0.44;

            return (
              <circle
                key={`loupe-stone-${pos.x}-${pos.y}`}
                cx={cx}
                cy={cy}
                r={stoneR}
                fill={piece === "black" ? "#1a1210" : "#f0e8d8"}
                stroke={piece === "black" ? "#191410" : "#ddd2bf"}
                strokeWidth="0.15"
              />
            );
          })}

          {/* Ghost stone at target position */}
          <circle
            cx={centerX}
            cy={centerY}
            r={GRID_STEP * 0.44}
            fill={stoneColor === "black" ? "#1a1210" : "#f0e8d8"}
            stroke={stoneColor === "black" ? "#191410" : "#ddd2bf"}
            strokeWidth="0.15"
            opacity={0.7}
          />

          {/* Crosshair ring */}
          <circle
            cx={centerX}
            cy={centerY}
            r={GRID_STEP * 0.55}
            fill="none"
            stroke="#e85d3a"
            strokeWidth="0.35"
            opacity={0.9}
          />
        </svg>
      </div>

      {/* Caret pointing down toward finger */}
      <div
        className="mx-auto h-0 w-0"
        style={{
          borderLeft: "6px solid transparent",
          borderRight: "6px solid transparent",
          borderTop: "6px solid #b89a64",
        }}
      />
    </div>
  );
}

export function TiaoBoard({
  state,
  selectedPiece,
  jumpTargets,
  disabled = false,
  confirmReady = true,
  lastMove,
  onPointClick,
  onUndoLastJump,
}: TiaoBoardProps) {
  const jumpTrailMarkerId = "tiao-jump-trail-arrow";

  // Compute last-move highlight positions
  const lastMovePositions = new Set<string>();
  if (lastMove) {
    if (lastMove.type === "put") {
      lastMovePositions.add(getPositionKey(lastMove.position));
    } else if (lastMove.type === "jump") {
      for (const step of lastMove.jumps) {
        lastMovePositions.add(getPositionKey(step.to));
      }
      if (lastMove.jumps.length > 0) {
        lastMovePositions.add(getPositionKey(lastMove.jumps[0].from));
      }
    }
  }
  const forcedJumpOrigin = getPendingJumpDestination(state);
  const activeOrigin = forcedJumpOrigin ?? selectedPiece;
  const hasPendingJump = state.pendingJump.length > 0;
  const canUndoLastJump = !!onUndoLastJump && hasPendingJump && !disabled;
  const lastPendingJump = hasPendingJump
    ? state.pendingJump[state.pendingJump.length - 1]
    : null;
  const historyLengthRef = useRef(state.history.length);
  const [celebratingPieceKey, setCelebratingPieceKey] = useState<string | null>(
    null
  );
  const [hoveredJumpTargetKey, setHoveredJumpTargetKey] = useState<string | null>(
    null
  );
  const [hoveredEmptyKey, setHoveredEmptyKey] = useState<string | null>(null);
  const [confirmHovered, setConfirmHovered] = useState(false);
  const [undoHovered, setUndoHovered] = useState(false);
  const selectableOrigins = getSelectableJumpOrigins(state).map(
    (position) => getPositionKey(position)
  );
  const jumpTargetKeys = jumpTargets.map(
    (position) => getPositionKey(position)
  );
  const hoveredJumpTarget =
    hoveredJumpTargetKey && activeOrigin
      ? jumpTargets.find(
          (position) => getPositionKey(position) === hoveredJumpTargetKey
        ) ?? null
      : null;
  const showConfirmOverlay =
    !!forcedJumpOrigin && hasPendingJump && confirmReady && confirmHovered;

  // -- Loupe state --
  const boardRef = useRef<HTMLDivElement>(null);
  const touchTimerRef = useRef<number | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const suppressClickRef = useRef(false);
  const loupeActiveRef = useRef(false);
  const [loupePosition, setLoupePosition] = useState<Position | null>(null);
  const [loupeScreenPos, setLoupeScreenPos] = useState<{ x: number; y: number } | null>(null);
  const [loupeActive, setLoupeActive] = useState(false);

  const activateLoupe = useCallback(
    (clientX: number, clientY: number) => {
      if (!boardRef.current || disabled) return;
      const rect = boardRef.current.getBoundingClientRect();
      const pos = touchToGridPosition(clientX, clientY, rect);
      setLoupePosition(pos);
      setLoupeScreenPos({ x: clientX, y: clientY });
      setLoupeActive(true);
      loupeActiveRef.current = true;
    },
    [disabled]
  );

  const clearLoupe = useCallback(() => {
    setLoupePosition(null);
    setLoupeScreenPos(null);
    setLoupeActive(false);
    loupeActiveRef.current = false;
    if (touchTimerRef.current !== null) {
      window.clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
  }, []);

  // Clear loupe on state changes
  useEffect(() => {
    clearLoupe();
  }, [state.currentTurn, state.history.length, disabled, clearLoupe]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (touchTimerRef.current !== null) {
        window.clearTimeout(touchTimerRef.current);
      }
    };
  }, []);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!IS_TOUCH_DEVICE || disabled || !boardRef.current) return;
      const touch = e.touches[0];
      touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };

      touchTimerRef.current = window.setTimeout(() => {
        activateLoupe(touch.clientX, touch.clientY);
      }, LOUPE_ACTIVATION_MS);
    },
    [disabled, activateLoupe]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!IS_TOUCH_DEVICE || !boardRef.current) return;
      const touch = e.touches[0];

      if (loupeActiveRef.current) {
        e.preventDefault();
        const rect = boardRef.current.getBoundingClientRect();
        const pos = touchToGridPosition(touch.clientX, touch.clientY, rect);
        setLoupePosition(pos);
        setLoupeScreenPos({ x: touch.clientX, y: touch.clientY });
        return;
      }

      // If moved too far before activation, cancel (user is scrolling)
      if (touchStartRef.current) {
        const dx = touch.clientX - touchStartRef.current.x;
        const dy = touch.clientY - touchStartRef.current.y;
        if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
          if (touchTimerRef.current !== null) {
            window.clearTimeout(touchTimerRef.current);
            touchTimerRef.current = null;
          }
        }
      }
    },
    []
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!IS_TOUCH_DEVICE) return;

      if (touchTimerRef.current !== null) {
        window.clearTimeout(touchTimerRef.current);
        touchTimerRef.current = null;
      }

      if (loupeActiveRef.current && loupePosition) {
        e.preventDefault();
        onPointClick(loupePosition);
        suppressClickRef.current = true;
        clearLoupe();
        return;
      }

      // Quick tap — let the regular onClick fire
      touchStartRef.current = null;
    },
    [loupePosition, onPointClick, clearLoupe]
  );

  const handleButtonClick = useCallback(
    (position: Position) => {
      if (IS_TOUCH_DEVICE && suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      onPointClick(position);
    },
    [onPointClick]
  );

  useEffect(() => {
    const previousLength = historyLengthRef.current;
    const nextLength = state.history.length;

    if (nextLength > previousLength) {
      const latestTurn = state.history[nextLength - 1];

      if (latestTurn?.type === "jump") {
        const landingJump = latestTurn.jumps[latestTurn.jumps.length - 1];

        if (landingJump) {
          setCelebratingPieceKey(`${landingJump.to.x}-${landingJump.to.y}`);
        }
      }
    }

    historyLengthRef.current = nextLength;
  }, [state.history]);

  useEffect(() => {
    if (!celebratingPieceKey) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      setCelebratingPieceKey(null);
    }, 560);

    return () => window.clearTimeout(timeout);
  }, [celebratingPieceKey]);

  useEffect(() => {
    if (!hoveredJumpTargetKey) {
      return;
    }

    if (!jumpTargetKeys.includes(hoveredJumpTargetKey)) {
      setHoveredJumpTargetKey(null);
    }
  }, [hoveredJumpTargetKey, jumpTargetKeys]);

  useEffect(() => {
    if (!showConfirmOverlay) {
      setConfirmHovered(false);
    }
  }, [showConfirmOverlay]);

  useEffect(() => {
    if (!canUndoLastJump) {
      setUndoHovered(false);
    }
  }, [canUndoLastJump]);

  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-[#cdb07f] bg-[linear-gradient(180deg,rgba(234,199,131,0.98),rgba(217,177,104,0.98))] p-3 shadow-[0_52px_120px_-42px_rgba(66,39,11,0.92)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,248,234,0.28),transparent_28%),linear-gradient(135deg,rgba(255,255,255,0.06),transparent_42%)]" />
      <div
        ref={boardRef}
        data-testid="tiao-board"
        className="relative aspect-square w-full rounded-[1.55rem] bg-[linear-gradient(180deg,rgba(255,250,240,0.16),rgba(255,255,255,0.04))]"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="boardGroove" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#7a542d" />
              <stop offset="100%" stopColor="#65421f" />
            </linearGradient>
          </defs>

          <rect
            x={GRID_START}
            y={GRID_START}
            width={GRID_SPAN}
            height={GRID_SPAN}
            fill="none"
            stroke="url(#boardGroove)"
            strokeWidth="0.72"
            vectorEffect="non-scaling-stroke"
          />

          {Array.from({ length: BOARD_SIZE }, (_, index) => {
            const coordinate = pointPercent(index);

            return (
              <g key={index}>
                <line
                  x1={GRID_START}
                  y1={coordinate}
                  x2={GRID_END}
                  y2={coordinate}
                  stroke="#6c4926"
                  strokeWidth="0.46"
                  strokeLinecap="square"
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1={coordinate}
                  y1={GRID_START}
                  x2={coordinate}
                  y2={GRID_END}
                  stroke="#6c4926"
                  strokeWidth="0.46"
                  strokeLinecap="square"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}

        </svg>

        {Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) => {
          const position = {
            x: index % BOARD_SIZE,
            y: Math.floor(index / BOARD_SIZE),
          };

          if (!isStarPoint(position)) {
            return null;
          }

          return (
            <span
              key={`star-${position.x}-${position.y}`}
              className="pointer-events-none absolute h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#573615]"
              style={{
                left: `${pointPercent(position.x)}%`,
                top: `${pointPercent(position.y)}%`,
              }}
            />
          );
        })}

        {Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) => {
          const position = {
            x: index % BOARD_SIZE,
            y: Math.floor(index / BOARD_SIZE),
          };
          const piece = state.positions[position.y][position.x];
          const pieceKey = getPositionKey(position);
          const isSelected = arePositionsEqual(selectedPiece, position);
          const isForcedOrigin = arePositionsEqual(forcedJumpOrigin, position);
          const isConfirmOrigin = hasPendingJump && isForcedOrigin;
          const showConfirmAffordance = isConfirmOrigin && confirmReady;
          const isJumpTarget = jumpTargetKeys.includes(pieceKey);
          const isMarkedForCapture = isPositionMarkedForCapture(state, position);
          const isSelectableOrigin = selectableOrigins.includes(pieceKey);
          const isHoveredEmpty = !piece && hoveredEmptyKey === pieceKey && !disabled && !activeOrigin && !IS_TOUCH_DEVICE;
          const isLastMove = lastMovePositions.has(pieceKey);

          return (
            <button
              key={pieceKey}
              type="button"
              data-testid={`cell-${position.x}-${position.y}`}
              data-piece={piece ?? undefined}
              disabled={disabled}
              onClick={() => handleButtonClick(position)}
              onPointerEnter={() => {
                if (IS_TOUCH_DEVICE) return;
                if (isJumpTarget && !disabled) {
                  setHoveredJumpTargetKey(pieceKey);
                }

                if (showConfirmAffordance && !disabled) {
                  setConfirmHovered(true);
                }

                if (!piece && !disabled) {
                  setHoveredEmptyKey(pieceKey);
                }
              }}
              onPointerLeave={() => {
                if (IS_TOUCH_DEVICE) return;
                if (hoveredJumpTargetKey === pieceKey) {
                  setHoveredJumpTargetKey(null);
                }

                if (showConfirmAffordance) {
                  setConfirmHovered(false);
                }

                if (hoveredEmptyKey === pieceKey) {
                  setHoveredEmptyKey(null);
                }
              }}
              onFocus={() => {
                if (isJumpTarget && !disabled) {
                  setHoveredJumpTargetKey(pieceKey);
                }

                if (showConfirmAffordance && !disabled) {
                  setConfirmHovered(true);
                }
              }}
              onBlur={() => {
                if (hoveredJumpTargetKey === pieceKey) {
                  setHoveredJumpTargetKey(null);
                }

                if (showConfirmAffordance) {
                  setConfirmHovered(false);
                }
              }}
              className={cn(
                "group absolute aspect-square -translate-x-1/2 -translate-y-1/2 transition-transform duration-150",
                isMarkedForCapture
                  ? "z-0"
                  : isForcedOrigin || isSelected
                    ? "z-20"
                    : "z-10",
                !disabled &&
                  (showConfirmAffordance
                    ? "cursor-pointer hover:scale-[1.12]"
                    : "hover:scale-[1.02]")
              )}
              style={{
                left: `${pointPercent(position.x)}%`,
                top: `${pointPercent(position.y)}%`,
                width: `${100 / BOARD_SIZE}%`,
              }}
            >
              {isJumpTarget ? (
                <span className="pointer-events-none absolute inset-[13.5%] rounded-full border-[3px] border-dashed border-[#73935f] bg-[rgba(243,250,238,0.78)] shadow-[0_0_0_2.5px_rgba(225,240,214,0.84)]" />
              ) : null}

              {isForcedOrigin ? (
                <span className="pointer-events-none absolute inset-[4.5%] rounded-full border-[3px] border-[#8c6326] shadow-[0_0_0_2.5px_rgba(214,176,112,0.84)]" />
              ) : isSelected ? (
                <span className="pointer-events-none absolute inset-[6.5%] rounded-full border-[2.5px] border-[#72572e]/95 shadow-[0_0_0_4px_rgba(114,87,46,0.2)]" />
              ) : isLastMove && piece ? (
                <span className="pointer-events-none absolute inset-[3%] rounded-full border-[2.5px] border-[#c4963c]/70 shadow-[0_0_0_3px_rgba(196,150,60,0.18)]" />
              ) : null}

              {isLastMove && !piece ? (
                <span className="pointer-events-none absolute inset-[35%] rounded-full bg-[#c4963c]/30" />
              ) : null}

              {piece ? (
                <motion.span
                  layout
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={
                    celebratingPieceKey === pieceKey
                      ? {
                          opacity: isMarkedForCapture ? 0.55 : 1,
                          scale: [1, 1.2, 0.98, 1.06, 1],
                          y: [0, -12, 0, -4, 0],
                        }
                      : {
                          opacity: isMarkedForCapture ? 0.55 : 1,
                          scale: 1,
                          y: 0,
                        }
                  }
                  transition={
                    celebratingPieceKey === pieceKey
                      ? {
                          duration: 0.56,
                          times: [0, 0.24, 0.52, 0.76, 1],
                          ease: [0.22, 1, 0.36, 1],
                        }
                      : { duration: 0.18, ease: "easeOut" }
                  }
                  className={cn(
                    "pointer-events-none absolute inset-[5.5%] z-10 rounded-full border shadow-[inset_0_2px_10px_rgba(255,255,255,0.18),0_10px_18px_rgba(0,0,0,0.18)]",
                    piece === "black"
                      ? "border-[#191410] bg-[radial-gradient(circle_at_30%_28%,#5d554f,#2d2622_58%,#0f0c0b)]"
                      : "border-[#ddd2bf] bg-[radial-gradient(circle_at_30%_28%,#fffdfa,#f4eee3_58%,#d9ccb8)]",
                    isSelectableOrigin &&
                      !disabled &&
                      "shadow-[0_0_0_4px_rgba(242,208,144,0.22),inset_0_2px_10px_rgba(255,255,255,0.18),0_10px_18px_rgba(0,0,0,0.18)]"
                  )}
                />
              ) : isHoveredEmpty ? (
                <span
                  className={cn(
                    "pointer-events-none absolute inset-[5.5%] z-10 rounded-full border opacity-40 shadow-sm",
                    state.currentTurn === "black"
                      ? "border-[#191410] bg-[radial-gradient(circle_at_30%_28%,#5d554f,#2d2622_58%,#0f0c0b)]"
                      : "border-[#ddd2bf] bg-[radial-gradient(circle_at_30%_28%,#fffdfa,#f4eee3_58%,#d9ccb8)]"
                  )}
                />
              ) : null}
            </button>
          );
        })}

        <svg
          className="pointer-events-none absolute inset-0 z-[80] h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <marker
              id={`${jumpTrailMarkerId}-overlay-green`}
              viewBox="0 0 8 8"
              refX="6.2"
              refY="4"
              markerWidth="5.4"
              markerHeight="5.4"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M0 0L8 4L0 8L2.15 4Z" fill="#8dbc62" fillOpacity="1" />
            </marker>
            <marker
              id={`${jumpTrailMarkerId}-overlay-red`}
              viewBox="0 0 8 8"
              refX="6.2"
              refY="4"
              markerWidth="5.4"
              markerHeight="5.4"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M0 0L8 4L0 8L2.15 4Z" fill="#c9837b" fillOpacity="1" />
            </marker>
          </defs>

          {state.pendingJump.map((jump, index) => {
            const segment = getJumpTrailMetrics(jump.from, jump.to);
            const arrowKey = `${jump.from.x}-${jump.from.y}-${jump.to.x}-${jump.to.y}-${index}`;

            return (
              <g key={arrowKey}>
                <motion.line
                  x1={segment.startX}
                  y1={segment.startY}
                  x2={segment.endX}
                  y2={segment.endY}
                  initial={{
                    x2: segment.startX,
                    y2: segment.startY,
                    opacity: 0,
                  }}
                  animate={{
                    x2: segment.endX,
                    y2: segment.endY,
                    opacity: 1,
                  }}
                  transition={{
                    duration: 0.24,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  stroke="#5f813d"
                  strokeOpacity="1"
                  strokeWidth="3.15"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
                <motion.line
                  x1={segment.startX}
                  y1={segment.startY}
                  x2={segment.endX}
                  y2={segment.endY}
                  initial={{
                    x2: segment.startX,
                    y2: segment.startY,
                    opacity: 0,
                  }}
                  animate={{
                    x2: segment.endX,
                    y2: segment.endY,
                    opacity: 1,
                  }}
                  transition={{
                    duration: 0.3,
                    delay: 0.04,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  stroke="#8dbc62"
                  strokeOpacity="1"
                  strokeWidth="2.45"
                  strokeLinecap="round"
                  markerEnd={`url(#${jumpTrailMarkerId}-overlay-green)`}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}

          {activeOrigin && hoveredJumpTarget ? (
            (() => {
              const segment = getJumpTrailMetrics(activeOrigin, hoveredJumpTarget);
              const previewKey = `preview-${getPositionKey(activeOrigin)}-${getPositionKey(hoveredJumpTarget)}`;

              return (
                <g key={previewKey}>
                  <motion.line
                    x1={segment.startX}
                    y1={segment.startY}
                    x2={segment.endX}
                    y2={segment.endY}
                    initial={{
                      x2: segment.startX,
                      y2: segment.startY,
                    }}
                    animate={{
                      x2: segment.endX,
                      y2: segment.endY,
                    }}
                    transition={{
                      duration: 0.28,
                      ease: [0.2, 0.96, 0.3, 1],
                    }}
                    stroke="#5f813d"
                    strokeWidth="3.4"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  <motion.line
                    x1={segment.startX}
                    y1={segment.startY}
                    x2={segment.endX}
                    y2={segment.endY}
                    initial={{
                      x2: segment.startX,
                      y2: segment.startY,
                    }}
                    animate={{
                      x2: segment.endX,
                      y2: segment.endY,
                    }}
                    transition={{
                      duration: 0.34,
                      delay: 0.03,
                      ease: [0.2, 0.96, 0.3, 1],
                    }}
                    stroke="#a6d476"
                    strokeWidth="2.7"
                    strokeLinecap="round"
                    markerEnd={`url(#${jumpTrailMarkerId}-overlay-green)`}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              );
            })()
          ) : null}

          {undoHovered && lastPendingJump ? (
            (() => {
              const segment = getJumpTrailMetrics(lastPendingJump.to, lastPendingJump.from);
              const undoPreviewKey = `undo-preview-${getPositionKey(lastPendingJump.to)}-${getPositionKey(lastPendingJump.from)}`;

              return (
                <g key={undoPreviewKey}>
                  <motion.line
                    x1={segment.startX}
                    y1={segment.startY}
                    x2={segment.endX}
                    y2={segment.endY}
                    initial={{
                      x2: segment.startX,
                      y2: segment.startY,
                    }}
                    animate={{
                      x2: segment.endX,
                      y2: segment.endY,
                    }}
                    transition={{
                      duration: 0.26,
                      ease: [0.2, 0.96, 0.3, 1],
                    }}
                    stroke="#9f5d57"
                    strokeWidth="3.25"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  <motion.line
                    x1={segment.startX}
                    y1={segment.startY}
                    x2={segment.endX}
                    y2={segment.endY}
                    initial={{
                      x2: segment.startX,
                      y2: segment.startY,
                    }}
                    animate={{
                      x2: segment.endX,
                      y2: segment.endY,
                    }}
                    transition={{
                      duration: 0.31,
                      delay: 0.03,
                      ease: [0.2, 0.96, 0.3, 1],
                    }}
                    stroke="#d8928a"
                    strokeWidth="2.55"
                    strokeLinecap="round"
                    markerEnd={`url(#${jumpTrailMarkerId}-overlay-red)`}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              );
            })()
          ) : null}
        </svg>

        {showConfirmOverlay && forcedJumpOrigin ? (
          <span
            className="pointer-events-none absolute z-[95] flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[#a7c191]/95 bg-[rgba(247,253,243,0.98)] text-[#5e7b4e] shadow-[0_14px_22px_-14px_rgba(66,89,47,0.62)]"
            style={{
              left: `${pointPercent(forcedJumpOrigin.x)}%`,
              top: `${pointPercent(forcedJumpOrigin.y)}%`,
            }}
          >
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
              className="h-3.5 w-3.5"
              fill="none"
            >
              <path
                d="M3.5 8.25L6.6 11.35L12.5 5.45"
                stroke="currentColor"
                strokeWidth="2.1"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        ) : null}

        {canUndoLastJump
          ? (() => {
              const lastJump = state.pendingJump[state.pendingJump.length - 1];

              return (
                <button
                  type="button"
                  onClick={onUndoLastJump}
                  onPointerEnter={() => setUndoHovered(true)}
                  onPointerLeave={() => setUndoHovered(false)}
                  onFocus={() => setUndoHovered(true)}
                  onBlur={() => setUndoHovered(false)}
                  className="absolute z-[90] aspect-square -translate-x-1/2 -translate-y-1/2 bg-transparent"
                  style={{
                    left: `${pointPercent(lastJump.from.x)}%`,
                    top: `${pointPercent(lastJump.from.y)}%`,
                    width: `${100 / BOARD_SIZE}%`,
                  }}
                  aria-label="Undo last jump"
                />
              );
            })()
          : null}

        {undoHovered && lastPendingJump ? (
          <span
            className="pointer-events-none absolute z-[95] flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[#deaaaa] bg-[rgba(255,247,246,0.98)] text-[#ba6561] shadow-[0_12px_20px_-14px_rgba(134,70,67,0.55)]"
            style={{
              left: `${pointPercent(lastPendingJump.from.x)}%`,
              top: `${pointPercent(lastPendingJump.from.y)}%`,
            }}
          >
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
              className="h-3.5 w-3.5"
              fill="none"
            >
              <path
                d="M4.25 4.25L11.75 11.75M11.75 4.25L4.25 11.75"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </span>
        ) : null}

        {/* Mobile magnifying loupe */}
        {loupeActive && loupePosition && loupeScreenPos && boardRef.current && (
          <LoupeBubble
            position={loupePosition}
            screenX={loupeScreenPos.x}
            screenY={loupeScreenPos.y}
            boardRect={boardRef.current.getBoundingClientRect()}
            state={state}
          />
        )}
      </div>
    </div>
  );
}
