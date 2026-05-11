import {
  arePositionsEqual,
  BOARD_SIZE,
  canPlacePiece,
  type GameState,
  getPendingJumpDestination,
  getSelectableJumpOrigins,
  isPositionMarkedForCapture,
  type Position,
  type RuleFailureCode,
} from "@shared";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { usePinchZoom } from "@/hooks/usePinchZoom";
import { IS_TOUCH_DEVICE } from "@/lib/isTouchDevice";
import { useBoardTheme } from "@/lib/useBoardTheme";
import { cn } from "@/lib/utils";
import {
  DRAG_THRESHOLD,
  DRAG_Y_OFFSET,
  getGhostStoneColors,
  getJumpTrailMetrics,
  getPositionKey,
  gridMetrics,
  isFatFingerNearAdjacentPiece,
  isStarPoint,
  type LastMoveHighlight,
  PLACEMENT_ERROR_KEYS,
  pointPercent,
  touchToGridPosition,
} from "./tiaoBoardHelpers";

export type { LastMoveHighlight } from "./tiaoBoardHelpers";
export { touchToGridPosition } from "./tiaoBoardHelpers";

type TiaoBoardProps = {
  state: GameState;
  selectedPiece: Position | null;
  jumpTargets: Position[];
  disabled?: boolean;
  confirmReady?: boolean;
  lastMove?: LastMoveHighlight;
  onPointClick?: (position: Position) => void;
  onUndoLastJump?: () => void;
  onConfirmJump?: () => void;
};

export function TiaoBoard({
  state,
  selectedPiece,
  jumpTargets,
  disabled = false,
  confirmReady = true,
  lastMove,
  onPointClick,
  onUndoLastJump,
  onConfirmJump,
}: TiaoBoardProps) {
  const t = useTranslations("game");
  const theme = useBoardTheme();
  const bs = state.boardSize ?? BOARD_SIZE;
  const m = useMemo(() => gridMetrics(bs), [bs]);
  const pp = useCallback((index: number) => pointPercent(index, m.gridStart, m.gridStep), [m]);
  const cellPercent = 100 / bs;

  const jumpTrailMarkerId = `tiao-jump-trail-arrow-${theme.id}`;

  // Compute last-move highlight positions
  const lastMovePositions = useMemo(() => {
    const set = new Set<string>();
    if (!lastMove) return set;
    if (lastMove.type === "put") {
      set.add(getPositionKey(lastMove.position));
    } else if (lastMove.type === "jump") {
      for (const step of lastMove.jumps) {
        set.add(getPositionKey(step.to));
      }
      if (lastMove.jumps.length > 0) {
        set.add(getPositionKey(lastMove.jumps[0].from));
      }
    }
    return set;
  }, [lastMove]);
  const forcedJumpOrigin = getPendingJumpDestination(state);
  const activeOrigin = forcedJumpOrigin ?? selectedPiece;
  const hasPendingJump = state.pendingJump.length > 0;
  const canUndoLastJump = !!onUndoLastJump && hasPendingJump && !disabled;
  const lastPendingJump = hasPendingJump ? state.pendingJump[state.pendingJump.length - 1] : null;
  const historyLengthRef = useRef(state.history.length);
  const [celebratingPieceKey, setCelebratingPieceKey] = useState<string | null>(null);
  const [hoveredJumpTargetKey, setHoveredJumpTargetKey] = useState<string | null>(null);
  const [hoveredEmptyKey, setHoveredEmptyKey] = useState<string | null>(null);
  const [confirmHovered, setConfirmHovered] = useState(false);
  const [undoHovered, setUndoHovered] = useState(false);
  // Bumped each time the user attempts an invalid placement; the changing
  // value remounts/restarts the shake animation on the offending ghost stone
  // so a second invalid click still re-triggers it.
  const [invalidShake, setInvalidShake] = useState<{ key: string; nonce: number } | null>(null);
  const selectableOrigins = getSelectableJumpOrigins(state).map((position) =>
    getPositionKey(position),
  );
  const jumpTargetKeys = jumpTargets.map((position) => getPositionKey(position));
  const hoveredJumpTarget =
    hoveredJumpTargetKey && activeOrigin
      ? (jumpTargets.find((position) => getPositionKey(position) === hoveredJumpTargetKey) ?? null)
      : null;
  const showConfirmOverlay = !!forcedJumpOrigin && hasPendingJump && confirmReady && confirmHovered;

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

  // Whether placement is even possible from the player's current state. When
  // there's an active jump origin or a pending jump, empty-cell clicks aren't
  // placement attempts (they may be jump targets or deselect actions), so we
  // suppress the invalid-placement feedback in those cases.
  const placementContextActive = !disabled && !activeOrigin && !hasPendingJump;

  const mobilePreviewCheck = mobilePreview ? canPlacePiece(state, mobilePreview) : null;
  const mobilePreviewValid = mobilePreviewCheck?.ok ?? false;

  const hoveredEmptyValidity = useMemo(() => {
    if (!hoveredEmptyKey || !placementContextActive || IS_TOUCH_DEVICE) return null;
    const [hx, hy] = hoveredEmptyKey.split("-").map(Number);
    if (state.positions[hy]?.[hx] != null) return null;
    return canPlacePiece(state, { x: hx, y: hy });
  }, [hoveredEmptyKey, placementContextActive, state]);
  const hoveredEmptyInvalid = hoveredEmptyValidity !== null && !hoveredEmptyValidity.ok;

  const showPlacementError = useCallback(
    (code: RuleFailureCode) => {
      toast.error(t(PLACEMENT_ERROR_KEYS[code] ?? "invalidPlacementToast"));
    },
    [t],
  );

  const triggerInvalidShake = useCallback((position: Position) => {
    setInvalidShake((prev) => ({
      key: getPositionKey(position),
      nonce: (prev?.nonce ?? 0) + 1,
    }));
  }, []);

  // Clear preview on state changes (turn switch, new move, disable). The
  // body uses only stable setters, but the deps drive WHEN this fires —
  // we genuinely want a re-run whenever turn/history/disabled flip.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are the change trigger, not the data read
  useEffect(() => {
    setMobilePreview(null);
    setMobilePreviewDragging(false);
    setMobilePreviewVisible(false);
  }, [state.currentTurn, state.history.length, disabled]);

  // Entrance animation trigger — fire only when preview toggles between
  // null/non-null, not on every position change as the user drags.
  const isPreviewActive = mobilePreview != null;
  useEffect(() => {
    if (isPreviewActive) {
      const raf = requestAnimationFrame(() => setMobilePreviewVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setMobilePreviewVisible(false);
    return undefined;
  }, [isPreviewActive]);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!IS_TOUCH_DEVICE || !boardRef.current) return;

      // Let zoom hook see all events first (zoom is always allowed)
      zoom.handlers.onTouchStart(e);

      // If multi-touch (pinch), clear preview and bail
      if (e.touches.length >= 2) {
        setMobilePreview(null);
        return;
      }

      // Game interactions (preview, drag, tap) are gated on disabled
      if (disabled) return;

      const touch = e.touches[0];
      touchStartRef.current = { x: touch.clientX, y: touch.clientY };
      touchStartTimeRef.current = Date.now();
      isDraggingPreviewRef.current = false;
    },
    [disabled, zoom.handlers],
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
            const fingerPos = touchToGridPosition(touch.clientX, touch.clientY, rect, bs);
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
          const pos = touchToGridPosition(touch.clientX, touch.clientY, rect, bs);
          const off = dragOffsetRef.current ?? { dx: 0, dy: -DRAG_Y_OFFSET };
          const offsetPos = {
            x: Math.max(0, Math.min(bs - 1, pos.x + off.dx)),
            y: Math.max(0, Math.min(bs - 1, pos.y + off.dy)),
          };
          if (!arePositionsEqual(mobilePreview, offsetPos)) {
            setMobilePreview(offsetPos);
          }
        }
      }
    },
    [zoom.handlers, zoom.gestureActiveRef, mobilePreview, bs],
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!IS_TOUCH_DEVICE || !boardRef.current) return;

      // Let zoom hook see all events first
      zoom.handlers.onTouchEnd(e);
      if (zoom.gestureActiveRef.current) {
        touchStartRef.current = null;
        isDraggingPreviewRef.current = false;
        return;
      }

      // Drag-to-adjust release: stop dragging, keep preview in place so
      // the confirm/cancel buttons stay visible.
      if (isDraggingPreviewRef.current && mobilePreview) {
        e.preventDefault();
        suppressClickRef.current = true;
        isDraggingPreviewRef.current = false;
        dragOffsetRef.current = null;
        setMobilePreviewDragging(false);
        touchStartRef.current = null;
        return;
      }

      isDraggingPreviewRef.current = false;
      dragOffsetRef.current = null;
      setMobilePreviewDragging(false);

      const touch = e.changedTouches[0];
      const startRef = touchStartRef.current;
      touchStartRef.current = null;

      // Scroll, not a tap → ignore.
      if (startRef) {
        const dx = touch.clientX - startRef.x;
        const dy = touch.clientY - startRef.y;
        if (Math.hypot(dx, dy) > DRAG_THRESHOLD) return;
      }

      const rect = boardRef.current.getBoundingClientRect();
      const pos = touchToGridPosition(touch.clientX, touch.clientY, rect, bs);
      const piece = state.positions[pos.y]?.[pos.x];
      const hasActiveOrigin = !!activeOrigin;

      // Tap on a piece or while a jump origin is active. We can't rely on
      // the browser generating a synthetic click — some browsers (and
      // Playwright) don't — so call onPointClick directly and suppress
      // the click to avoid double-fires.
      if (piece || hasActiveOrigin) {
        e.preventDefault();
        suppressClickRef.current = true;
        // If a preview is showing, tapping a piece should cancel the
        // preview first, NOT select it for jumping.
        if (mobilePreview && !hasActiveOrigin) {
          setMobilePreview(null);
          return;
        }
        onPointClick?.(pos);
        return;
      }

      // Fat-finger near an adjacent piece → fall through to onClick on the
      // larger button hit area.
      if (
        isFatFingerNearAdjacentPiece(
          pos,
          touch.clientX,
          touch.clientY,
          rect,
          state.positions,
          bs,
          m,
          pp,
        )
      ) {
        return;
      }

      // Quick-tap confirm: short tap on the EXISTING valid preview cell
      // commits the placement. Taps on a different cell reposition instead.
      const tapDuration = Date.now() - touchStartTimeRef.current;
      const tappedPreviewPos = mobilePreview && arePositionsEqual(mobilePreview, pos);
      if (mobilePreview && mobilePreviewValid && tappedPreviewPos && tapDuration < 150) {
        e.preventDefault();
        suppressClickRef.current = true;
        const confirmPos = mobilePreview;
        setMobilePreview(null);
        onPointClick?.(confirmPos);
        return;
      }

      // Empty intersection, no selection → preview flow. If the cell is
      // illegal, give explicit feedback (toast + shake) instead of just
      // disabling the Place button silently.
      e.preventDefault();
      suppressClickRef.current = true;
      if (!activeOrigin && !hasPendingJump) {
        const check = canPlacePiece(state, pos);
        if (!check.ok) {
          triggerInvalidShake(pos);
          showPlacementError(check.code);
        }
      }
      setMobilePreview(pos);
    },
    [
      state,
      activeOrigin,
      hasPendingJump,
      mobilePreview,
      mobilePreviewValid,
      onPointClick,
      zoom.handlers,
      zoom.gestureActiveRef,
      triggerInvalidShake,
      showPlacementError,
      bs,
      m,
      pp,
    ],
  );

  const handleButtonClick = useCallback(
    (position: Position) => {
      if (IS_TOUCH_DEVICE && suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      // Pre-validate placement attempts so we can give the player a reason
      // for the rejection (toast + shake) instead of the click silently
      // doing nothing. Only intercept when the click really is a placement
      // attempt — empty cell, no active origin, no pending jump — so jump
      // targets, deselect-cells, and piece selections still flow through.
      if (
        !disabled &&
        !activeOrigin &&
        !hasPendingJump &&
        state.positions[position.y]?.[position.x] == null
      ) {
        const check = canPlacePiece(state, position);
        if (!check.ok) {
          triggerInvalidShake(position);
          showPlacementError(check.code);
          return;
        }
      }
      onPointClick?.(position);
    },
    [
      onPointClick,
      disabled,
      activeOrigin,
      hasPendingJump,
      state,
      triggerInvalidShake,
      showPlacementError,
    ],
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
    <div
      className={cn("relative z-0 overflow-hidden rounded-4xl border p-3")}
      style={{
        borderColor: theme.boardBorder,
        background: theme.boardBg,
        boxShadow: theme.boardShadow,
      }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: theme.boardSheen }}
      />
      <div
        ref={boardRef}
        data-testid="tiao-board"
        className={cn(
          "relative aspect-square w-full rounded-[1.55rem]",
          IS_TOUCH_DEVICE && "touch-none",
          zoom.isAnimating &&
            "transition-transform duration-250 ease-[cubic-bezier(0.22,1,0.36,1)]",
        )}
        style={{
          background: theme.boardInnerBg,
          ...(zoom.transformStyle
            ? { transform: zoom.transformStyle, transformOrigin: "center center" }
            : {}),
        }}
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
            <linearGradient id={`boardGroove-${theme.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={theme.grooveStart} />
              <stop offset="100%" stopColor={theme.grooveEnd} />
            </linearGradient>
          </defs>

          <rect
            x={m.gridStart}
            y={m.gridStart}
            width={m.gridSpan}
            height={m.gridSpan}
            fill="none"
            stroke={`url(#boardGroove-${theme.id})`}
            strokeWidth="0.72"
            vectorEffect="non-scaling-stroke"
          />

          {Array.from({ length: bs }, (_, index) => {
            const coordinate = pp(index);

            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: stable list rendered once, no reorder
              <g key={index}>
                <line
                  x1={m.gridStart}
                  y1={coordinate}
                  x2={m.gridEnd}
                  y2={coordinate}
                  stroke={theme.gridLineColor}
                  strokeWidth="0.46"
                  strokeLinecap="square"
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1={coordinate}
                  y1={m.gridStart}
                  x2={coordinate}
                  y2={m.gridEnd}
                  stroke={theme.gridLineColor}
                  strokeWidth="0.46"
                  strokeLinecap="square"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}
        </svg>

        {Array.from({ length: bs * bs }, (_, index) => {
          const position = {
            x: index % bs,
            y: Math.floor(index / bs),
          };

          if (!isStarPoint(position, bs)) {
            return null;
          }

          return (
            <span
              key={`star-${position.x}-${position.y}`}
              className="pointer-events-none absolute h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                background: theme.starPointColor,
                left: `${pp(position.x)}%`,
                top: `${pp(position.y)}%`,
              }}
            />
          );
        })}

        {Array.from({ length: bs * bs }, (_, index) => {
          const position = {
            x: index % bs,
            y: Math.floor(index / bs),
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
          const isHoveredEmpty =
            !piece &&
            hoveredEmptyKey === pieceKey &&
            !disabled &&
            !activeOrigin &&
            !IS_TOUCH_DEVICE;
          const isLastMove = lastMovePositions.has(pieceKey);

          return (
            <button
              key={pieceKey}
              type="button"
              data-testid={`cell-${position.x}-${position.y}`}
              data-piece={piece ?? undefined}
              data-last-move={isLastMove || undefined}
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
                if (IS_TOUCH_DEVICE) return;
                if (isJumpTarget && !disabled) {
                  setHoveredJumpTargetKey(pieceKey);
                }

                if (showConfirmAffordance && !disabled) {
                  setConfirmHovered(true);
                }
              }}
              onBlur={() => {
                if (IS_TOUCH_DEVICE) return;
                if (hoveredJumpTargetKey === pieceKey) {
                  setHoveredJumpTargetKey(null);
                }

                if (showConfirmAffordance) {
                  setConfirmHovered(false);
                }
              }}
              className={cn(
                "group absolute aspect-square -translate-x-1/2 -translate-y-1/2 transition-transform duration-150",
                isMarkedForCapture ? "z-0" : isForcedOrigin || isSelected ? "z-20" : "z-10",
                disabled
                  ? "cursor-default"
                  : showConfirmAffordance
                    ? "cursor-pointer hover:scale-[1.12]"
                    : "hover:scale-[1.02]",
              )}
              style={{
                left: `${pp(position.x)}%`,
                top: `${pp(position.y)}%`,
                width: `${cellPercent}%`,
              }}
            >
              {isJumpTarget ? (
                <span
                  className="pointer-events-none absolute inset-[13.5%] rounded-full border-[3px] border-dashed"
                  style={{
                    borderColor: theme.jumpTargetBorder,
                    background: theme.jumpTargetBg,
                    boxShadow: `0 0 0 2.5px ${theme.jumpTargetBg}`,
                  }}
                />
              ) : null}

              {isForcedOrigin ? (
                <span
                  className="pointer-events-none absolute inset-[4.5%] rounded-full border-[3px]"
                  style={{
                    borderColor: theme.forcedOriginBorder,
                    boxShadow: `0 0 0 2.5px ${theme.forcedOriginBorder}44`,
                  }}
                />
              ) : isSelected && isSelectableOrigin ? (
                // Selected piece that can jump: draw a green ring AROUND the
                // piece (inset [3%], same placement as the last-move ring)
                // instead of inside it, so the outline is actually visible
                // against the board surface.  The green matches the
                // jump-preview arrows so the selection ties into the same
                // visual language as the jump targets.
                <span
                  className="pointer-events-none absolute inset-[3%] rounded-full border-[2.5px]"
                  style={{
                    borderColor: theme.jumpTrailBrightGreen,
                    boxShadow: `0 0 0 3px ${theme.jumpTrailBrightGreen}40`,
                  }}
                />
              ) : isSelected ? (
                <span
                  className="pointer-events-none absolute inset-[6.5%] rounded-full border-[2.5px]"
                  style={{
                    borderColor: theme.selectedBorder,
                    boxShadow: `0 0 0 4px ${theme.selectedBorder}33`,
                  }}
                />
              ) : isLastMove && piece ? (
                <span
                  className="pointer-events-none absolute inset-[3%] rounded-full border-[2.5px]"
                  style={{
                    borderColor: `${theme.lastMoveBorder}b3`,
                    boxShadow: `0 0 0 3px ${theme.lastMoveBorder}2e`,
                  }}
                />
              ) : null}

              {isLastMove && !piece ? (
                <span
                  className="pointer-events-none absolute inset-[35%] rounded-full"
                  style={{ background: `${theme.lastMoveDotBg}4d` }}
                />
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
                  className="pointer-events-none absolute inset-[5.5%] z-10 rounded-full border"
                  style={{
                    borderColor:
                      piece === "black" ? theme.blackPieceBorder : theme.whitePieceBorder,
                    background: piece === "black" ? theme.blackPieceBg : theme.whitePieceBg,
                    boxShadow:
                      isSelectableOrigin && !disabled && hasPendingJump
                        ? theme.selectableGlow
                        : theme.pieceShadow,
                  }}
                />
              ) : isHoveredEmpty ? (
                (() => {
                  const showInvalid = hoveredEmptyKey === pieceKey && hoveredEmptyInvalid;
                  const shaking = invalidShake?.key === pieceKey && invalidShake.nonce > 0;
                  return (
                    <motion.span
                      key={shaking ? `shake-${invalidShake.nonce}` : "ghost"}
                      animate={shaking ? { x: [0, -3, 3, -3, 3, -2, 2, 0] } : { x: 0 }}
                      transition={shaking ? { duration: 0.42, ease: "easeInOut" } : { duration: 0 }}
                      className="pointer-events-none absolute inset-[5.5%] z-10 rounded-full border opacity-40 shadow-xs"
                      style={getGhostStoneColors(theme, !showInvalid, state.currentTurn)}
                    />
                  );
                })()
              ) : null}
            </button>
          );
        })}

        <svg
          className="pointer-events-none absolute inset-0 z-80 h-full w-full"
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
              <path d="M0 0L8 4L0 8L2.15 4Z" fill={theme.jumpArrowGreenFill} fillOpacity="1" />
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
              <path d="M0 0L8 4L0 8L2.15 4Z" fill={theme.jumpArrowRedFill} fillOpacity="1" />
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
              <path d="M0 0L8 4L0 8L2.15 4Z" fill={theme.lastMoveArrowFill} fillOpacity="0.85" />
            </marker>
          </defs>

          {state.pendingJump.map((jump, index) => {
            const segment = getJumpTrailMetrics(jump.from, jump.to, pp);
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
                  stroke={theme.jumpTrailDarkGreen}
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
                  stroke={theme.jumpTrailBrightGreen}
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
          {lastMove?.type === "jump" &&
            lastMove.jumps.map((jump, index) => {
              const segment = getJumpTrailMetrics(jump.from, jump.to, pp);
              const arrowKey = `lastmove-${jump.from.x}-${jump.from.y}-${jump.to.x}-${jump.to.y}-${index}`;

              return (
                <g key={arrowKey}>
                  <line
                    x1={segment.startX}
                    y1={segment.startY}
                    x2={segment.endX}
                    y2={segment.endY}
                    stroke={theme.lastMoveDark}
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
                    stroke={theme.lastMoveBright}
                    strokeOpacity="0.7"
                    strokeWidth="2.45"
                    strokeLinecap="round"
                    markerEnd={`url(#${jumpTrailMarkerId}-overlay-gold)`}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              );
            })}

          {activeOrigin && hoveredJumpTarget
            ? (() => {
                const segment = getJumpTrailMetrics(activeOrigin, hoveredJumpTarget, pp);
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
                      stroke={theme.jumpTrailDarkGreen}
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
                      stroke={theme.jumpTrailPreviewGreen}
                      strokeWidth="2.7"
                      strokeLinecap="round"
                      markerEnd={`url(#${jumpTrailMarkerId}-overlay-green)`}
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                );
              })()
            : null}

          {undoHovered && lastPendingJump
            ? (() => {
                const segment = getJumpTrailMetrics(lastPendingJump.to, lastPendingJump.from, pp);
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
                      stroke={theme.jumpTrailDarkRed}
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
                      stroke={theme.jumpTrailBrightRed}
                      strokeWidth="2.55"
                      strokeLinecap="round"
                      markerEnd={`url(#${jumpTrailMarkerId}-overlay-red)`}
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                );
              })()
            : null}
        </svg>

        {showConfirmOverlay && forcedJumpOrigin ? (
          <span
            className="pointer-events-none absolute z-95 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border"
            style={{
              borderColor: theme.confirmBorder,
              background: theme.confirmBg,
              color: theme.confirmText,
              boxShadow: theme.confirmShadow,
              left: `${pp(forcedJumpOrigin.x)}%`,
              top: `${pp(forcedJumpOrigin.y)}%`,
            }}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5" fill="none">
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
                  className="absolute z-90 aspect-square -translate-x-1/2 -translate-y-1/2 bg-transparent"
                  style={{
                    left: `${pp(lastJump.from.x)}%`,
                    top: `${pp(lastJump.from.y)}%`,
                    width: `${cellPercent}%`,
                  }}
                  aria-label="Undo last jump"
                />
              );
            })()
          : null}

        {undoHovered && lastPendingJump ? (
          <span
            className="pointer-events-none absolute z-95 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border"
            style={{
              borderColor: theme.undoBorder,
              background: theme.undoBg,
              color: theme.undoText,
              boxShadow: theme.undoShadow,
              left: `${pp(lastPendingJump.from.x)}%`,
              top: `${pp(lastPendingJump.from.y)}%`,
            }}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5" fill="none">
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
            className="pointer-events-none absolute inset-0 z-35 h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <motion.line
              x1={m.gridStart}
              y1={pp(mobilePreview.y)}
              x2={m.gridEnd}
              y2={pp(mobilePreview.y)}
              stroke={theme.crosshairColor}
              strokeOpacity="0.35"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
              animate={{ y1: pp(mobilePreview.y), y2: pp(mobilePreview.y) }}
              transition={{ duration: 0.08, ease: "easeOut" }}
            />
            <motion.line
              x1={pp(mobilePreview.x)}
              y1={m.gridStart}
              x2={pp(mobilePreview.x)}
              y2={m.gridEnd}
              stroke={theme.crosshairColor}
              strokeOpacity="0.35"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
              animate={{ x1: pp(mobilePreview.x), x2: pp(mobilePreview.x) }}
              transition={{ duration: 0.08, ease: "easeOut" }}
            />
          </svg>
        )}

        {/* Mobile ghost stone preview */}
        {mobilePreview &&
          !disabled &&
          (() => {
            const previewKey = getPositionKey(mobilePreview);
            const shaking = invalidShake?.key === previewKey && invalidShake.nonce > 0;
            return (
              <motion.span
                data-testid="mobile-preview-loupe"
                key={shaking ? `mobile-shake-${invalidShake.nonce}` : "mobile-ghost"}
                animate={shaking ? { x: [0, -4, 4, -4, 4, -2, 2, 0] } : { x: 0 }}
                transition={shaking ? { duration: 0.42, ease: "easeInOut" } : { duration: 0 }}
                className="pointer-events-none absolute z-30"
                style={{
                  left: `${pp(mobilePreview.x)}%`,
                  top: `${pp(mobilePreview.y)}%`,
                  width: `${cellPercent * 0.88}%`,
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
                    transform: mobilePreviewDragging
                      ? "translateY(12%) scale(1.1)"
                      : "translateY(8%) scale(1.05)",
                    opacity: mobilePreviewDragging ? 0.5 : 0.7,
                    transition: "transform 150ms ease-out, opacity 150ms ease-out",
                  }}
                />
                {/* Stone */}
                <span
                  className={cn("relative block h-full w-full rounded-full", "border")}
                  style={{
                    ...getGhostStoneColors(theme, mobilePreviewValid, state.currentTurn),
                    opacity: !mobilePreviewValid ? 0.45 : mobilePreviewDragging ? 0.6 : 0.8,
                    transform: mobilePreviewDragging ? "translateY(-3px)" : "translateY(-1px)",
                    boxShadow: mobilePreviewDragging
                      ? "0 6px 16px rgba(0,0,0,0.25), inset 0 2px 10px rgba(255,255,255,0.18)"
                      : "0 3px 8px rgba(0,0,0,0.2), inset 0 2px 10px rgba(255,255,255,0.18)",
                    transition:
                      "opacity 150ms ease-out, transform 150ms ease-out, box-shadow 150ms ease-out",
                  }}
                />
              </motion.span>
            );
          })()}
      </div>

      {/* Bottom-right floating controls */}
      <AnimatePresence>
        {IS_TOUCH_DEVICE && (zoom.isZoomed || mobilePreview || (hasPendingJump && !disabled)) && (
          <motion.div
            key="board-controls"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-5 right-5 z-100 flex items-center gap-2"
          >
            {/* Cancel + Confirm placement */}
            {mobilePreview && !disabled && (
              <>
                <button
                  type="button"
                  onClick={() => setMobilePreview(null)}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-[#c9837b]/50 bg-[rgba(255,248,232,0.92)] text-[#9a5b52] shadow-[0_8px_20px_-8px_rgba(66,39,11,0.5)] backdrop-blur-sm transition-colors active:bg-[rgba(200,180,150,0.9)]"
                  aria-label="Cancel placement"
                >
                  <svg aria-hidden="true" viewBox="0 0 14 14" fill="none" className="h-4 w-4">
                    <path
                      d="M3.5 3.5l7 7M10.5 3.5l-7 7"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  disabled={!mobilePreviewValid}
                  onClick={() => {
                    const pos = mobilePreview;
                    setMobilePreview(null);
                    onPointClick?.(pos);
                  }}
                  className={cn(
                    "flex h-11 items-center gap-1.5 rounded-full border px-3.5 shadow-[0_8px_20px_-8px_rgba(66,39,11,0.5)] backdrop-blur-sm transition-colors",
                    mobilePreviewValid
                      ? "border-[#8aad6a]/50 bg-[rgba(255,248,232,0.92)] text-[#5e7b4e] active:bg-[rgba(200,220,180,0.9)]"
                      : "border-[#c4a978]/30 bg-[rgba(255,248,232,0.6)] text-[#b0a08a] cursor-not-allowed",
                  )}
                  aria-label="Confirm placement"
                >
                  <svg aria-hidden="true" viewBox="0 0 14 14" fill="none" className="h-4 w-4">
                    <path
                      d="M3 7.5l2.8 2.8L11 4"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="text-sm font-semibold">Place</span>
                </button>
              </>
            )}
            {/* Undo + Confirm jump (mobile only) */}
            {hasPendingJump && !disabled && !mobilePreview && (
              <>
                {onUndoLastJump && (
                  <button
                    type="button"
                    onClick={onUndoLastJump}
                    className="flex h-11 w-11 items-center justify-center rounded-full border border-[#c9837b]/50 bg-[rgba(255,248,232,0.92)] text-[#9a5b52] shadow-[0_8px_20px_-8px_rgba(66,39,11,0.5)] backdrop-blur-sm transition-colors active:bg-[rgba(200,180,150,0.9)]"
                    aria-label="Undo last jump"
                  >
                    <svg aria-hidden="true" viewBox="0 0 14 14" fill="none" className="h-4 w-4">
                      <path
                        d="M3.5 3.5l7 7M10.5 3.5l-7 7"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                )}
                {onConfirmJump && (
                  <button
                    type="button"
                    onClick={onConfirmJump}
                    className="flex h-11 items-center gap-1.5 rounded-full border border-[#8aad6a]/50 bg-[rgba(255,248,232,0.92)] px-3.5 text-[#5e7b4e] shadow-[0_8px_20px_-8px_rgba(66,39,11,0.5)] backdrop-blur-sm transition-colors active:bg-[rgba(200,220,180,0.9)]"
                    aria-label="Confirm jump"
                  >
                    <svg aria-hidden="true" viewBox="0 0 14 14" fill="none" className="h-4 w-4">
                      <path
                        d="M3 7.5l2.8 2.8L11 4"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="text-sm font-semibold">Confirm</span>
                  </button>
                )}
              </>
            )}
            {/* Zoom indicator — tap to reset */}
            {zoom.isZoomed && (
              <button
                type="button"
                onClick={zoom.resetZoom}
                className="flex h-9 items-center gap-1.5 rounded-full border border-[#af8a56]/50 bg-[rgba(255,248,232,0.92)] px-3 text-[#3a2818] shadow-[0_8px_20px_-8px_rgba(66,39,11,0.5)] backdrop-blur-sm"
              >
                <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden="true">
                  <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
                  <path
                    d="M11 11l3.5 3.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
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
