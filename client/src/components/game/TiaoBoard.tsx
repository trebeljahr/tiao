import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
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
import { usePinchZoom } from "@/hooks/usePinchZoom";
import { GRID_LINE_COLOR } from "./boardStyles";

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

const DRAG_THRESHOLD = 10;
const DRAG_Y_OFFSET = 4; // grid cells to offset above finger during drag
const DIRECT_PLACE_CELL_PX = 44; // min cell size in px for direct placement (Apple HIG tap target)

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

  // -- Mobile tap-to-preview state --
  const boardRef = useRef<HTMLDivElement>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);
  const [mobilePreview, setMobilePreview] = useState<Position | null>(null);
  const [mobilePreviewDragging, setMobilePreviewDragging] = useState(false);
  const [mobilePreviewVisible, setMobilePreviewVisible] = useState(false);
  const isDraggingPreviewRef = useRef(false);
  const dragOffsetRef = useRef<{ dx: number; dy: number } | null>(null);
  const touchStartTimeRef = useRef(0);

  // -- Pinch-to-zoom --
  const zoom = usePinchZoom({
    containerRef: boardRef,
    panDisabled: mobilePreview !== null,
  });

  // Clear preview on state changes (turn switch, new move, disable)
  useEffect(() => {
    setMobilePreview(null);
    setMobilePreviewDragging(false);
    setMobilePreviewVisible(false);
  }, [state.currentTurn, state.history.length, disabled]);

  // Entrance animation trigger
  useEffect(() => {
    if (mobilePreview) {
      // Small delay to allow DOM to mount before triggering CSS transition
      const raf = requestAnimationFrame(() => setMobilePreviewVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setMobilePreviewVisible(false);
    return undefined;
  }, [mobilePreview !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!IS_TOUCH_DEVICE || disabled || !boardRef.current) return;

      // Let zoom hook see all events first
      zoom.handlers.onTouchStart(e);

      // If multi-touch (pinch), clear preview and bail
      if (e.touches.length >= 2) {
        setMobilePreview(null);
        return;
      }

      const touch = e.touches[0];
      touchStartRef.current = { x: touch.clientX, y: touch.clientY };
      touchStartTimeRef.current = Date.now();
      isDraggingPreviewRef.current = false;
    },
    [disabled, zoom.handlers]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!IS_TOUCH_DEVICE || !boardRef.current) return;

      // Let zoom hook see all events
      zoom.handlers.onTouchMove(e);
      if (zoom.gestureActiveRef.current) return;

      // Drag-to-adjust: if preview is active and finger moved enough, snap preview
      if (mobilePreview && touchStartRef.current && e.touches.length === 1) {
        const touch = e.touches[0];
        const dx = touch.clientX - touchStartRef.current.x;
        const dy = touch.clientY - touchStartRef.current.y;

        if (isDraggingPreviewRef.current || Math.hypot(dx, dy) > DRAG_THRESHOLD) {
          if (!isDraggingPreviewRef.current) {
            // First drag frame — compute offset between finger and current preview
            isDraggingPreviewRef.current = true;
            setMobilePreviewDragging(true);
            const rect = boardRef.current.getBoundingClientRect();
            const fingerPos = touchToGridPosition(touch.clientX, touch.clientY, rect);
            // If this is a fresh placement (no existing preview near finger),
            // apply default offset; otherwise preserve the existing gap
            const existingGapY = mobilePreview.y - fingerPos.y;
            const existingGapX = mobilePreview.x - fingerPos.x;
            if (Math.abs(existingGapX) <= 1 && Math.abs(existingGapY) <= 1) {
              // Finger is on/near the preview — apply default upward offset
              dragOffsetRef.current = { dx: 0, dy: -DRAG_Y_OFFSET };
            } else {
              // Reconnecting — keep the existing gap
              dragOffsetRef.current = { dx: existingGapX, dy: existingGapY };
            }
          }
          e.preventDefault();
          const rect = boardRef.current.getBoundingClientRect();
          const pos = touchToGridPosition(touch.clientX, touch.clientY, rect);
          const off = dragOffsetRef.current ?? { dx: 0, dy: -DRAG_Y_OFFSET };
          const offsetPos = {
            x: Math.max(0, Math.min(BOARD_SIZE - 1, pos.x + off.dx)),
            y: Math.max(0, Math.min(BOARD_SIZE - 1, pos.y + off.dy)),
          };
          if (!arePositionsEqual(mobilePreview, offsetPos)) {
            setMobilePreview(offsetPos);
          }
        }
      }
    },
    [zoom.handlers, zoom.gestureActiveRef, mobilePreview, state.positions]
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!IS_TOUCH_DEVICE || !boardRef.current) return;

      // Let zoom hook see all events
      zoom.handlers.onTouchEnd(e);
      if (zoom.gestureActiveRef.current) {
        touchStartRef.current = null;
        isDraggingPreviewRef.current = false;
        return;
      }

      // Drag-to-adjust: on release, stop dragging and show confirm/cancel
      if (isDraggingPreviewRef.current && mobilePreview) {
        e.preventDefault();
        suppressClickRef.current = true;
        isDraggingPreviewRef.current = false;
        dragOffsetRef.current = null;
        setMobilePreviewDragging(false);
        touchStartRef.current = null;
        // Keep preview in place — confirm/cancel buttons will show
        return;
      }

      isDraggingPreviewRef.current = false;
      dragOffsetRef.current = null;
      setMobilePreviewDragging(false);
      const touch = e.changedTouches[0];

      // Check if this was a drag (scrolling), not a tap
      if (touchStartRef.current) {
        const dx = touch.clientX - touchStartRef.current.x;
        const dy = touch.clientY - touchStartRef.current.y;
        if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
          touchStartRef.current = null;
          return;
        }
      }

      const rect = boardRef.current.getBoundingClientRect();
      const pos = touchToGridPosition(touch.clientX, touch.clientY, rect);
      touchStartRef.current = null;

      // If there's already a piece, a selection, or a jump target at this
      // position, skip preview and let the normal click handler deal with it.
      const piece = state.positions[pos.y]?.[pos.x];
      const hasActiveOrigin = !!activeOrigin;

      if (piece || hasActiveOrigin) {
        // Let the regular onClick fire
        return;
      }

      // Fat-finger tolerance: if tapped an empty cell but there's a piece
      // on an adjacent intersection, let the click handler deal with it
      // (the button's hit area will catch it)
      if (!piece && !hasActiveOrigin) {
        const adjacentOffsets = [[-1,0],[1,0],[0,-1],[0,1]];
        const hasAdjacentPiece = adjacentOffsets.some(([ox,oy]) => {
          const nx = pos.x + ox, ny = pos.y + oy;
          return nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE &&
            state.positions[ny]?.[nx] != null;
        });
        // Check pixel distance to the nearest adjacent piece — if closer to it
        // than the grid step, skip preview
        if (hasAdjacentPiece) {
          const touchPctX = ((touch.clientX - rect.left) / rect.width) * 100;
          const touchPctY = ((touch.clientY - rect.top) / rect.height) * 100;
          const snapPctX = pointPercent(pos.x);
          const snapPctY = pointPercent(pos.y);
          const distToSnap = Math.hypot(touchPctX - snapPctX, touchPctY - snapPctY);
          // If tap was far from the snapped cell center (> 60% of grid step),
          // likely meant to tap the adjacent piece
          if (distToSnap > GRID_STEP * 0.6) {
            return; // let onClick handle it
          }
        }
      }

      // Quick tap to confirm: if preview is showing, position is valid,
      // and the tap was short and sharp (< 150ms), confirm placement
      const tapDuration = Date.now() - touchStartTimeRef.current;
      const previewValid = mobilePreview && state.positions[mobilePreview.y]?.[mobilePreview.x] == null;
      if (mobilePreview && previewValid && tapDuration < 150) {
        e.preventDefault();
        suppressClickRef.current = true;
        const confirmPos = mobilePreview;
        setMobilePreview(null);
        onPointClick(confirmPos);
        return;
      }

      // Empty intersection with no selection — mobile preview flow
      e.preventDefault();
      suppressClickRef.current = true;
      // Tap repositions the preview (or creates it if none exists)
      setMobilePreview(pos);
    },
    [state.positions, activeOrigin, mobilePreview, onPointClick, zoom.handlers, zoom.gestureActiveRef]
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

  const mobilePreviewValid = mobilePreview
    ? state.positions[mobilePreview.y]?.[mobilePreview.x] == null
    : false;

  return (
    <div className="relative z-0 overflow-hidden rounded-[2rem] border border-[#cdb07f] bg-[linear-gradient(180deg,rgba(234,199,131,0.98),rgba(217,177,104,0.98))] p-3 shadow-[0_52px_120px_-42px_rgba(66,39,11,0.92)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,248,234,0.28),transparent_28%),linear-gradient(135deg,rgba(255,255,255,0.06),transparent_42%)]" />
      <div
        ref={boardRef}
        data-testid="tiao-board"
        className={cn(
          "relative aspect-square w-full rounded-[1.55rem] bg-[linear-gradient(180deg,rgba(255,250,240,0.16),rgba(255,255,255,0.04))]",
          IS_TOUCH_DEVICE && "touch-none",
          zoom.isAnimating && "transition-transform duration-[250ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
        )}
        style={zoom.transformStyle ? { transform: zoom.transformStyle, transformOrigin: "center center" } : undefined}
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
                <span className="pointer-events-none absolute inset-[3%] rounded-full border-[2.5px] border-[#4a8ac4]/70 shadow-[0_0_0_3px_rgba(74,138,196,0.18)]" />
              ) : null}

              {isLastMove && !piece ? (
                <span className="pointer-events-none absolute inset-[35%] rounded-full bg-[#4a8ac4]/30" />
              ) : null}

              {piece ? (
                <motion.span
                  layout={!zoom.isZoomed}
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
            <marker
              id={`${jumpTrailMarkerId}-overlay-gold`}
              viewBox="0 0 8 8"
              refX="6.2"
              refY="4"
              markerWidth="5.4"
              markerHeight="5.4"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M0 0L8 4L0 8L2.15 4Z" fill="#4a8ac4" fillOpacity="0.85" />
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

          {/* Last move jump trail arrows (review mode) */}
          {lastMove?.type === "jump" && lastMove.jumps.map((jump, index) => {
            const segment = getJumpTrailMetrics(jump.from, jump.to);
            const arrowKey = `lastmove-${jump.from.x}-${jump.from.y}-${jump.to.x}-${jump.to.y}-${index}`;

            return (
              <g key={arrowKey}>
                <line
                  x1={segment.startX}
                  y1={segment.startY}
                  x2={segment.endX}
                  y2={segment.endY}
                  stroke="#365f8a"
                  strokeOpacity="0.5"
                  strokeWidth="3.15"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1={segment.startX}
                  y1={segment.startY}
                  x2={segment.endX}
                  y2={segment.endY}
                  stroke="#4a8ac4"
                  strokeOpacity="0.7"
                  strokeWidth="2.45"
                  strokeLinecap="round"
                  markerEnd={`url(#${jumpTrailMarkerId}-overlay-gold)`}
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

        {/* Mobile crosshair overlay */}
        {mobilePreview && !disabled && IS_TOUCH_DEVICE && (
          <svg
            className="pointer-events-none absolute inset-0 z-[35] h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <motion.line
              x1={GRID_START}
              y1={pointPercent(mobilePreview.y)}
              x2={GRID_END}
              y2={pointPercent(mobilePreview.y)}
              stroke={GRID_LINE_COLOR}
              strokeOpacity="0.35"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
              animate={{ y1: pointPercent(mobilePreview.y), y2: pointPercent(mobilePreview.y) }}
              transition={{ duration: 0.08, ease: "easeOut" }}
            />
            <motion.line
              x1={pointPercent(mobilePreview.x)}
              y1={GRID_START}
              x2={pointPercent(mobilePreview.x)}
              y2={GRID_END}
              stroke={GRID_LINE_COLOR}
              strokeOpacity="0.35"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
              animate={{ x1: pointPercent(mobilePreview.x), x2: pointPercent(mobilePreview.x) }}
              transition={{ duration: 0.08, ease: "easeOut" }}
            />
          </svg>
        )}

        {/* Mobile ghost stone preview */}
        {mobilePreview && !disabled && (
          <span
            className="pointer-events-none absolute z-30"
            style={{
              left: `${pointPercent(mobilePreview.x)}%`,
              top: `${pointPercent(mobilePreview.y)}%`,
              width: `${100 / BOARD_SIZE * 0.88}%`,
              aspectRatio: "1",
              transform: `translate(-50%, -50%) scale(${mobilePreviewVisible ? 1 : 0.5})`,
              opacity: mobilePreviewVisible ? 1 : 0,
              transition: mobilePreviewDragging
                ? "left 70ms ease-out, top 70ms ease-out"
                : "left 70ms ease-out, top 70ms ease-out, transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 120ms ease-out",
            }}
          >
            {/* Hovering shadow */}
            <span
              className="absolute inset-[-4%] rounded-full"
              style={{
                background: "radial-gradient(circle, rgba(0,0,0,0.18) 0%, transparent 70%)",
                transform: mobilePreviewDragging ? "translateY(12%) scale(1.1)" : "translateY(8%) scale(1.05)",
                opacity: mobilePreviewDragging ? 0.5 : 0.7,
                transition: "transform 150ms ease-out, opacity 150ms ease-out",
              }}
            />
            {/* Stone */}
            <span
              className={cn(
                "relative block h-full w-full rounded-full",
                !mobilePreviewValid
                  ? "border border-[#c44a3a]/60 bg-[radial-gradient(circle_at_30%_28%,#d4847a,#b85a4e_58%,#8a3028)]"
                  : state.currentTurn === "black"
                    ? "border border-[#191410] bg-[radial-gradient(circle_at_30%_28%,#5d554f,#2d2622_58%,#0f0c0b)]"
                    : "border border-[#ddd2bf] bg-[radial-gradient(circle_at_30%_28%,#fffdfa,#f4eee3_58%,#d9ccb8)]",
              )}
              style={{
                opacity: !mobilePreviewValid ? 0.45 : mobilePreviewDragging ? 0.6 : 0.8,
                transform: mobilePreviewDragging ? "translateY(-3px)" : "translateY(-1px)",
                boxShadow: mobilePreviewDragging
                  ? "0 6px 16px rgba(0,0,0,0.25), inset 0 2px 10px rgba(255,255,255,0.18)"
                  : "0 3px 8px rgba(0,0,0,0.2), inset 0 2px 10px rgba(255,255,255,0.18)",
                transition: "opacity 150ms ease-out, transform 150ms ease-out, box-shadow 150ms ease-out",
              }}
            />
          </span>
        )}

      </div>

      {/* Bottom-right floating controls */}
      <AnimatePresence>
        {IS_TOUCH_DEVICE && (zoom.isZoomed || mobilePreview) && (
          <motion.div
            key="board-controls"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-5 right-5 z-[100] flex items-center gap-2"
          >
            {/* Cancel + Confirm placement */}
            {mobilePreview && !disabled && (
              <>
                <button
                  type="button"
                  onClick={() => setMobilePreview(null)}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-[#c9837b]/50 bg-[rgba(255,248,232,0.92)] text-[#9a5b52] shadow-[0_8px_20px_-8px_rgba(66,39,11,0.5)] backdrop-blur transition-colors active:bg-[rgba(200,180,150,0.9)]"
                  aria-label="Cancel placement"
                >
                  <svg viewBox="0 0 14 14" fill="none" className="h-4 w-4">
                    <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  disabled={!mobilePreviewValid}
                  onClick={() => { const pos = mobilePreview; setMobilePreview(null); onPointClick(pos); }}
                  className={cn(
                    "flex h-11 items-center gap-1.5 rounded-full border px-3.5 shadow-[0_8px_20px_-8px_rgba(66,39,11,0.5)] backdrop-blur transition-colors",
                    mobilePreviewValid
                      ? "border-[#8aad6a]/50 bg-[rgba(255,248,232,0.92)] text-[#5e7b4e] active:bg-[rgba(200,220,180,0.9)]"
                      : "border-[#c4a978]/30 bg-[rgba(255,248,232,0.6)] text-[#b0a08a] cursor-not-allowed",
                  )}
                  aria-label="Confirm placement"
                >
                  <svg viewBox="0 0 14 14" fill="none" className="h-4 w-4">
                    <path d="M3 7.5l2.8 2.8L11 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="text-sm font-semibold">Place</span>
                </button>
              </>
            )}
            {/* Zoom indicator — tap to reset */}
            {zoom.isZoomed && (
              <button
                type="button"
                onClick={zoom.resetZoom}
                className="flex h-9 items-center gap-1.5 rounded-full border border-[#af8a56]/50 bg-[rgba(255,248,232,0.92)] px-3 text-[#3a2818] shadow-[0_8px_20px_-8px_rgba(66,39,11,0.5)] backdrop-blur"
              >
                <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden="true">
                  <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M5 7h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <span className="text-xs font-semibold">{Math.round(zoom.scale * 10) / 10}x</span>
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
