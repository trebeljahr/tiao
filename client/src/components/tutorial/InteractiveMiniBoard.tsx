import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import confetti from "canvas-confetti";
import {
  type Cell,
  type Pos,
  type JumpRecord,
  posEq,
  cloneBoard,
  getJumpTargets,
  getSelectableJumpOrigins,
  canPlacePiece,
} from "./tutorialEngine";
import type { StepBoardConfig } from "./tutorialSteps";
import { useBoardTheme } from "@/lib/useBoardTheme";
import { cn } from "@/lib/utils";
import { playMoveSoundIfEnabled } from "@/lib/useStonePlacementSound";

const IS_TOUCH_DEVICE =
  typeof window !== "undefined" &&
  ("ontouchstart" in window || navigator.maxTouchPoints > 0);

function fireLightConfetti(colors: string[]) {
  confetti({
    particleCount: 60,
    startVelocity: 35,
    spread: 360,
    origin: { x: 0.5, y: 0.45 },
    colors,
    scalar: 0.9,
    gravity: 0.8,
    ticks: 70,
    shapes: ["circle", "square"],
  });
}

type Props = {
  config: StepBoardConfig;
  onComplete: () => void;
  active: boolean;
  resetKey: number;
};

// --- Grid math (matches TiaoBoard's coordinate system) ---

function gridStart(size: number) {
  return 100 / (size * 2);
}
function gridEnd(size: number) {
  return 100 - gridStart(size);
}
function gridSpan(size: number) {
  return gridEnd(size) - gridStart(size);
}
function gridStep(size: number) {
  return gridSpan(size) / (size - 1);
}
function pointPct(index: number, size: number) {
  return gridStart(size) + gridStep(size) * index;
}

function getJumpTrailMetrics(from: Pos, to: Pos, size: number, startInset = 0.7, endInset = 1.1) {
  const startX = pointPct(from.x, size);
  const startY = pointPct(from.y, size);
  const endX = pointPct(to.x, size);
  const endY = pointPct(to.y, size);
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const distance = Math.hypot(deltaX, deltaY);

  if (distance === 0) {
    return { startX, startY, endX, endY };
  }

  const unitX = deltaX / distance;
  const unitY = deltaY / distance;
  return {
    startX: startX + unitX * startInset,
    startY: startY + unitY * startInset,
    endX: endX - unitX * endInset,
    endY: endY - unitY * endInset,
  };
}

// --- Component ---

export function InteractiveMiniBoard({
  config,
  onComplete,
  active,
  resetKey,
}: Props) {
  const theme = useBoardTheme();
  const { size, initialBoard, interaction, turnColor = "W", thickBorder, suggestedPos, hintArrows } = config;
  const [board, setBoard] = useState<Cell[][]>(() => cloneBoard(initialBoard));
  const [selected, setSelected] = useState<Pos | null>(null);
  const [pendingJumps, setPendingJumps] = useState<JumpRecord[]>([]);
  const [pendingCaptures, setPendingCaptures] = useState<Pos[]>([]);
  const [completed, setCompleted] = useState(false);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [confirmHovered, setConfirmHovered] = useState(false);
  const [undoHovered, setUndoHovered] = useState(false);
  const [shakePos, setShakePos] = useState<Pos | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [triedIllegal, setTriedIllegal] = useState(false);
  const [hasUndone, setHasUndone] = useState(false);
  const [hasSeenConfirmHint, setHasSeenConfirmHint] = useState(false);
  const [showConfirmNudge, setShowConfirmNudge] = useState(false);
  const completedRef = useRef(false);

  const color = turnColor;
  const hasPending = pendingJumps.length > 0;
  const forcedOrigin = hasPending
    ? pendingJumps[pendingJumps.length - 1].to
    : null;
  const activeOrigin = forcedOrigin ?? selected;
  const jumpTargetPositions = activeOrigin
    ? getJumpTargets(board, activeOrigin, color, size, pendingCaptures)
    : [];
  const selectableOrigins = getSelectableJumpOrigins(
    board,
    color,
    size,
    pendingCaptures,
  );
  const lastJump = hasPending ? pendingJumps[pendingJumps.length - 1] : null;

  // Reset on step change
  useEffect(() => {
    setBoard(cloneBoard(initialBoard));
    setSelected(null);
    setPendingJumps([]);
    setPendingCaptures([]);
    setCompleted(false);
    setHoveredKey(null);
    setConfirmHovered(false);
    setUndoHovered(false);
    setShakePos(null);
    setErrorMsg(null);
    setTriedIllegal(false);
    setHasUndone(false);
    setHasSeenConfirmHint(false);
    setShowConfirmNudge(false);
    completedRef.current = false;
  }, [resetKey, initialBoard]);

  // After a pending jump in chain-jump steps, nudge the user to confirm after 3s
  useEffect(() => {
    if (
      hasPending &&
      !completed &&
      (interaction.type === "chain-jump" || interaction.type === "chain-jump-early")
    ) {
      setShowConfirmNudge(false);
      const timer = setTimeout(() => setShowConfirmNudge(true), 3000);
      return () => clearTimeout(timer);
    }
    setShowConfirmNudge(false);
  }, [hasPending, completed, interaction.type, pendingJumps.length]);

  const complete = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    setCompleted(true);
    fireLightConfetti(theme.victoryColors);
    setTimeout(() => onComplete(), 800);
  }, [onComplete]);

  // --- Click handler (mirrors useLocalGame state machine) ---
  function handleClick(pos: Pos) {
    if (!active || completed || completedRef.current) return;

    // Handle try-and-fail interactions
    if (
      (interaction.type === "try-and-fail" ||
        interaction.type === "try-and-fail-border") &&
      !triedIllegal
    ) {
      if (posEq(pos, interaction.illegal)) {
        setShakePos(pos);
        setErrorMsg(interaction.errorMessage ?? "Illegal move!");
        setTimeout(() => {
          setShakePos(null);
          setErrorMsg(null);
          setTriedIllegal(true);
        }, 1200);
        return;
      }
      // Ignore other clicks until they try the illegal one
      return;
    }

    if (
      (interaction.type === "try-and-fail" ||
        interaction.type === "try-and-fail-border") &&
      triedIllegal
    ) {
      if (posEq(pos, interaction.then)) {
        const next = cloneBoard(board);
        next[pos.y][pos.x] = color;
        setBoard(next);
        playMoveSoundIfEnabled();
        complete();
      }
      return;
    }

    // Guided jump interactions
    if (interaction.type === "guided-jump") {
      if (!selected && posEq(pos, interaction.selectPiece)) {
        setSelected(pos);
      } else if (selected && posEq(pos, interaction.jumpTo)) {
        executeJump(selected, pos);
        // Auto-confirm after delay
        setTimeout(() => {
          confirmJump();
        }, 500);
      }
      return;
    }

    // --- Standard game-like interaction (free-place, confirm-undo, chain-jump, chain-jump-early) ---

    // If we have a forced origin (pending jumps), handle confirm/continue
    if (forcedOrigin) {
      if (posEq(pos, forcedOrigin)) {
        // Confirm
        confirmJump();
        return;
      }
      // Check if it's a jump target
      const isTarget = jumpTargetPositions.some((t) => posEq(t, pos));
      if (isTarget) {
        executeJump(forcedOrigin, pos);
        return;
      }
      return; // Ignore other clicks during pending jump
    }

    // If piece is selected but not forced
    if (selected) {
      if (posEq(pos, selected)) {
        setSelected(null);
        return;
      }
      const isTarget = jumpTargetPositions.some((t) => posEq(t, pos));
      if (isTarget) {
        executeJump(selected, pos);
        return;
      }
    }

    // Try placement
    const cell = board[pos.y][pos.x];
    if (!cell) {
      if (interaction.type === "free-place") {
        const result = canPlacePiece(board, pos, color, size);
        if (result.ok) {
          const next = cloneBoard(board);
          next[pos.y][pos.x] = color;
          setBoard(next);
          playMoveSoundIfEnabled();
          if (interaction.type === "free-place") {
            const isBorder = pos.x === 0 || pos.y === 0 || pos.x === size - 1 || pos.y === size - 1;
            if (interaction.completionZone === "border" && !isBorder) {
              // Placed validly but not on border — show hint, don't complete
              setShakePos(pos);
              setErrorMsg("Place on the border to defend!");
              setBoard(cloneBoard(board));
              setTimeout(() => { setShakePos(null); setErrorMsg(null); }, 1200);
            } else if (interaction.requiredPos && !posEq(pos, interaction.requiredPos)) {
              // Placed validly but not at required position — show hint, revert
              setShakePos(pos);
              setErrorMsg("Try the highlighted spot!");
              setBoard(cloneBoard(board));
              setTimeout(() => { setShakePos(null); setErrorMsg(null); }, 1200);
            } else {
              complete();
            }
          }
          return;
        }
      }
    }

    // Try selecting a piece (but never in free-place steps — only placement allowed there)
    if (cell === color && interaction.type !== "free-place") {
      const targets = getJumpTargets(board, pos, color, size, pendingCaptures);
      if (targets.length > 0) {
        setSelected(pos);
      }
      return;
    }

    setSelected(null);
  }

  function executeJump(from: Pos, to: Pos) {
    const next = cloneBoard(board);
    next[from.y][from.x] = null;
    next[to.y][to.x] = color;
    const mid: Pos = {
      x: (from.x + to.x) / 2,
      y: (from.y + to.y) / 2,
    };
    // Keep captured piece on board — render as ghost until confirmed
    const newCaptures = [...pendingCaptures, mid];
    const newJumps = [...pendingJumps, { from, to, over: mid }];

    setBoard(next);
    setPendingCaptures(newCaptures);
    setPendingJumps(newJumps);
    setSelected(null);
    playMoveSoundIfEnabled();
  }

  function confirmJump() {
    // For chain-undo, only complete if user has actually undone
    if (interaction.type === "chain-undo" && !hasUndone) {
      return; // Don't allow confirming before undoing
    }
    // Set completed FIRST to prevent nudge flash, then clear state
    setCompleted(true);
    completedRef.current = true;
    // Use functional setState to avoid stale closure when called from setTimeout
    setPendingCaptures((caps) => {
      setBoard((prev) => {
        const next = cloneBoard(prev);
        for (const cap of caps) {
          next[cap.y][cap.x] = null;
        }
        return next;
      });
      return [];
    });
    setPendingJumps([]);
    setSelected(null);
    fireLightConfetti(theme.victoryColors);
    setTimeout(() => onComplete(), 800);
  }

  function undoLastJump() {
    if (!hasPending) return;
    const last = pendingJumps[pendingJumps.length - 1];
    const next = cloneBoard(board);
    next[last.from.y][last.from.x] = color;
    next[last.to.y][last.to.x] = null;
    // Captured piece is still on the board, just remove from pending captures

    setBoard(next);
    setPendingJumps(pendingJumps.slice(0, -1));
    setPendingCaptures(pendingCaptures.filter((c) => !posEq(c, last.over)));
    setUndoHovered(false);
    setHasUndone(true);
  }

  // --- Nudge logic ---
  function getNudge(): { pos: Pos; label: string } | null {
    if (completed || completedRef.current) return null;

    if (interaction.type === "guided-jump") {
      if (hasPending) return null; // Jump executed, waiting for auto-confirm
      if (!selected) return { pos: interaction.selectPiece, label: "Select this piece" };
      return { pos: interaction.jumpTo, label: "Jump here!" };
    }
    if (interaction.type === "free-place") {
      if (suggestedPos) return { pos: suggestedPos, label: "Place here" };
      return null;
    }
    if (interaction.type === "confirm-undo") {
      if (!hasPending && !selected) {
        return { pos: interaction.selectPiece!, label: "Select this piece" };
      }
      if (selected && !hasPending) {
        return { pos: interaction.jumpTo!, label: "Jump here!" };
      }
      if (hasPending) {
        const confirmLabel = IS_TOUCH_DEVICE
          ? "Tap again to confirm"
          : "Click to confirm (or undo)";
        return { pos: forcedOrigin!, label: confirmLabel };
      }
    }
    if (interaction.type === "chain-jump" || interaction.type === "chain-jump-early") {
      if (!selected && !hasPending) {
        return { pos: interaction.firstSelect, label: "Select this piece" };
      }
      if (hasPending && forcedOrigin && showConfirmNudge) {
        return { pos: forcedOrigin, label: "Click the piece to confirm" };
      }
    }
    if (interaction.type === "chain-undo") {
      if (!selected && !hasPending) {
        return { pos: interaction.firstSelect, label: "Select this piece" };
      }
      if (hasPending && pendingJumps.length >= interaction.undoAfterJumps && !hasUndone) {
        // After enough jumps, nudge the undo button
        return lastJump ? { pos: lastJump.from, label: "Undo this jump ↩" } : null;
      }
      if (hasUndone && hasPending && forcedOrigin) {
        return { pos: forcedOrigin, label: "Confirm ✓" };
      }
    }
    if (
      interaction.type === "try-and-fail" ||
      interaction.type === "try-and-fail-border"
    ) {
      if (!triedIllegal) return { pos: interaction.illegal, label: "Try placing here" };
      return { pos: interaction.then, label: "Place here instead" };
    }
    return null;
  }

  const nudge = getNudge();

  // On mobile, show a prominent confirm circle the first time a confirm is needed
  const showMobileConfirmHint =
    IS_TOUCH_DEVICE &&
    !hasSeenConfirmHint &&
    hasPending &&
    forcedOrigin &&
    !completed;

  // Mark the hint as seen once the confirm circle has been shown
  useEffect(() => {
    if (showMobileConfirmHint) {
      const timer = setTimeout(() => setHasSeenConfirmHint(true), 3000);
      return () => clearTimeout(timer);
    }
  }, [showMobileConfirmHint]);

  // Show confirm affordance when hovering forced origin
  const showConfirmOverlay = !!forcedOrigin && hasPending && confirmHovered && !completed;

  // --- Rendering ---
  const gs = gridStart(size);
  const ge = gridEnd(size);
  const gsp = gridSpan(size);
  const markerId = "tutorial-jump-arrow";

  // Hover target detection
  const hoveredPos = hoveredKey
    ? { x: parseInt(hoveredKey.split("-")[0]), y: parseInt(hoveredKey.split("-")[1]) }
    : null;
  const isHoveringJumpTarget =
    hoveredPos && jumpTargetPositions.some((t) => posEq(t, hoveredPos));
  const hoveredJumpTarget = isHoveringJumpTarget ? hoveredPos : null;

  // Should we show hover ghost? Only on valid placement positions.
  const showHoverGhost =
    hoveredPos &&
    !completed &&
    active &&
    !board[hoveredPos.y]?.[hoveredPos.x] &&
    !activeOrigin &&
    (interaction.type === "free-place" ||
      ((interaction.type === "try-and-fail" ||
        interaction.type === "try-and-fail-border") &&
        triedIllegal)) &&
    canPlacePiece(board, hoveredPos, color, size).ok;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative">
        {/* Board container — matches TiaoBoard styling */}
        <div
          className={cn(
            "relative overflow-hidden rounded-[1.2rem] border p-2 shadow-[0_32px_70px_-28px_rgba(66,39,11,0.75)]",
            size <= 5 ? "w-[280px]" : "w-[340px]",
          )}
          style={{
            background: theme.boardBg,
            borderColor: theme.boardBorder,
          }}
        >
          <div className="relative aspect-square w-full rounded-[0.9rem]">
            {/* Grid SVG */}
            <svg
              className="absolute inset-0 h-full w-full"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="tutBoardGroove" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor={theme.grooveStart} />
                  <stop offset="100%" stopColor={theme.grooveEnd} />
                </linearGradient>
              </defs>

              {/* Board edge — thicker for tutorial to emphasize borders */}
              <rect
                x={gs}
                y={gs}
                width={gsp}
                height={gsp}
                fill="none"
                stroke="url(#tutBoardGroove)"
                strokeWidth={thickBorder ? 3 : 1.2}
                vectorEffect="non-scaling-stroke"
              />

              {/* Grid lines */}
              {Array.from({ length: size }, (_, i) => {
                const coord = pointPct(i, size);
                return (
                  <g key={i}>
                    <line
                      x1={gs}
                      y1={coord}
                      x2={ge}
                      y2={coord}
                      stroke={theme.gridLineColor}
                      strokeWidth="0.46"
                      strokeLinecap="square"
                      vectorEffect="non-scaling-stroke"
                    />
                    <line
                      x1={coord}
                      y1={gs}
                      x2={coord}
                      y2={ge}
                      stroke={theme.gridLineColor}
                      strokeWidth="0.46"
                      strokeLinecap="square"
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                );
              })}
            </svg>

            {/* Pieces and interaction buttons */}
            {Array.from({ length: size * size }, (_, index) => {
              const pos: Pos = { x: index % size, y: Math.floor(index / size) };
              const cell = board[pos.y][pos.x];
              const key = `${pos.x}-${pos.y}`;
              const isSelected = selected && posEq(selected, pos);
              const isForcedOrigin = forcedOrigin && posEq(forcedOrigin, pos);
              const isJumpTarget = jumpTargetPositions.some((t) => posEq(t, pos));
              const isCapture = pendingCaptures.some((c) => posEq(c, pos));
              const isSelectable = selectableOrigins.some((o) => posEq(o, pos));
              const showConfirmAffordance = isForcedOrigin && hasPending;

              return (
                <button
                  key={key}
                  type="button"
                  disabled={!active || completed}
                  onClick={() => handleClick(pos)}
                  onPointerEnter={() => {
                    if (!active || completed) return;
                    setHoveredKey(key);
                    if (showConfirmAffordance) setConfirmHovered(true);
                  }}
                  onPointerLeave={() => {
                    if (hoveredKey === key) setHoveredKey(null);
                    if (showConfirmAffordance) setConfirmHovered(false);
                    setUndoHovered(false);
                  }}
                  className={cn(
                    "group absolute aspect-square -translate-x-1/2 -translate-y-1/2 transition-transform duration-150",
                    isCapture ? "z-0" : isForcedOrigin || isSelected ? "z-20" : "z-10",
                    active && !completed &&
                      (showConfirmAffordance
                        ? "cursor-pointer hover:scale-[1.12]"
                        : "hover:scale-[1.02]"),
                  )}
                  style={{
                    left: `${pointPct(pos.x, size)}%`,
                    top: `${pointPct(pos.y, size)}%`,
                    width: `${100 / size}%`,
                  }}
                >
                  {/* Jump target ring */}
                  {isJumpTarget && (
                    <span className="pointer-events-none absolute inset-[13.5%] rounded-full border-[3px] border-dashed border-[#73935f] bg-[rgba(243,250,238,0.78)] shadow-[0_0_0_2.5px_rgba(225,240,214,0.84)]" />
                  )}

                  {/* Selection/forced origin rings */}
                  {isForcedOrigin ? (
                    <span className="pointer-events-none absolute inset-[4.5%] rounded-full border-[3px] border-[#8c6326] shadow-[0_0_0_2.5px_rgba(214,176,112,0.84)]" />
                  ) : isSelected ? (
                    <span className="pointer-events-none absolute inset-[6.5%] rounded-full border-[2.5px] border-[#72572e]/95 shadow-[0_0_0_4px_rgba(114,87,46,0.2)]" />
                  ) : null}

                  {/* Piece */}
                  {cell ? (
                    <span
                      className="pointer-events-none absolute inset-[5.5%] z-10 rounded-full border transition-opacity duration-200"
                      style={{
                        borderColor:
                          cell === "B" ? theme.blackPieceBorder : theme.whitePieceBorder,
                        background: cell === "B" ? theme.blackPieceBg : theme.whitePieceBg,
                        boxShadow:
                          isSelectable && active && !completed
                            ? theme.selectableGlow
                            : theme.pieceShadow,
                        opacity: isCapture ? 0.55 : 1,
                      }}
                    />
                  ) : showHoverGhost && posEq(pos, hoveredPos!) ? (
                    <span
                      className="pointer-events-none absolute inset-[5.5%] z-10 rounded-full border opacity-40 shadow-sm"
                      style={{
                        borderColor:
                          color === "B" ? theme.blackPieceBorder : theme.whitePieceBorder,
                        background: color === "B" ? theme.blackPieceBg : theme.whitePieceBg,
                      }}
                    />
                  ) : null}
                </button>
              );
            })}

            {/* Jump trail arrows SVG overlay */}
            <svg
              className="pointer-events-none absolute inset-0 z-[80] h-full w-full"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <defs>
                <marker
                  id={`${markerId}-green`}
                  viewBox="0 0 8 8"
                  refX="6.2"
                  refY="4"
                  markerWidth="5.4"
                  markerHeight="5.4"
                  orient="auto"
                  markerUnits="strokeWidth"
                >
                  <path d="M0 0L8 4L0 8L2.15 4Z" fill={theme.jumpArrowGreenFill} />
                </marker>
                <marker
                  id={`${markerId}-red`}
                  viewBox="0 0 8 8"
                  refX="6.2"
                  refY="4"
                  markerWidth="5.4"
                  markerHeight="5.4"
                  orient="auto"
                  markerUnits="strokeWidth"
                >
                  <path d="M0 0L8 4L0 8L2.15 4Z" fill={theme.jumpArrowRedFill} />
                </marker>
                <marker
                  id={`${markerId}-hint`}
                  viewBox="0 0 8 8"
                  refX="6.2"
                  refY="4"
                  markerWidth="5.4"
                  markerHeight="5.4"
                  orient="auto"
                  markerUnits="strokeWidth"
                >
                  <path d="M0 0L8 4L0 8L2.15 4Z" fill="#c4a876" fillOpacity="0.6" />
                </marker>
              </defs>

              {/* Hint arrows — green dashed arrows showing enemy jump paths */}
              {/* For try-and-fail: shown after failed attempt. For free-place: shown immediately */}
              {(triedIllegal || interaction.type === "free-place") && hintArrows?.map((arrow, i) => {
                // Shorter arrows with bigger insets so they don't overlap pieces
                const seg = getJumpTrailMetrics(arrow.from, arrow.to, size, 1.8, 2.2);
                return (
                  <g key={`hint-${i}`}>
                    <motion.line
                      x1={seg.startX} y1={seg.startY} x2={seg.endX} y2={seg.endY}
                      initial={{ x2: seg.startX, y2: seg.startY, opacity: 0 }}
                      animate={{ x2: seg.endX, y2: seg.endY, opacity: 1 }}
                      transition={{ duration: 0.3, delay: i * 0.15, ease: [0.22, 1, 0.36, 1] }}
                      stroke={theme.jumpTrailDarkGreen}
                      strokeOpacity="0.7"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeDasharray="5 3"
                      vectorEffect="non-scaling-stroke"
                    />
                    <motion.line
                      x1={seg.startX} y1={seg.startY} x2={seg.endX} y2={seg.endY}
                      initial={{ x2: seg.startX, y2: seg.startY, opacity: 0 }}
                      animate={{ x2: seg.endX, y2: seg.endY, opacity: 1 }}
                      transition={{ duration: 0.35, delay: i * 0.15 + 0.04, ease: [0.22, 1, 0.36, 1] }}
                      stroke={theme.jumpTrailBrightGreen}
                      strokeOpacity="0.85"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeDasharray="5 3"
                      markerEnd={`url(#${markerId}-green)`}
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                );
              })}

              {/* Completed jump trails */}
              {pendingJumps.map((jump, index) => {
                const seg = getJumpTrailMetrics(jump.from, jump.to, size);
                return (
                  <g key={`trail-${index}`}>
                    <motion.line
                      x1={seg.startX} y1={seg.startY} x2={seg.endX} y2={seg.endY}
                      initial={{ x2: seg.startX, y2: seg.startY, opacity: 0 }}
                      animate={{ x2: seg.endX, y2: seg.endY, opacity: 1 }}
                      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                      stroke={theme.jumpTrailDarkGreen}
                      strokeWidth="3.15"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                    <motion.line
                      x1={seg.startX} y1={seg.startY} x2={seg.endX} y2={seg.endY}
                      initial={{ x2: seg.startX, y2: seg.startY, opacity: 0 }}
                      animate={{ x2: seg.endX, y2: seg.endY, opacity: 1 }}
                      transition={{ duration: 0.3, delay: 0.04, ease: [0.22, 1, 0.36, 1] }}
                      stroke={theme.jumpTrailBrightGreen}
                      strokeWidth="2.45"
                      strokeLinecap="round"
                      markerEnd={`url(#${markerId}-green)`}
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                );
              })}

              {/* Hover preview arrow */}
              {activeOrigin && hoveredJumpTarget && (() => {
                const seg = getJumpTrailMetrics(activeOrigin, hoveredJumpTarget, size);
                return (
                  <g>
                    <motion.line
                      x1={seg.startX} y1={seg.startY} x2={seg.endX} y2={seg.endY}
                      initial={{ x2: seg.startX, y2: seg.startY }}
                      animate={{ x2: seg.endX, y2: seg.endY }}
                      transition={{ duration: 0.28, ease: [0.2, 0.96, 0.3, 1] }}
                      stroke={theme.jumpTrailDarkGreen}
                      strokeWidth="3.4"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                    <motion.line
                      x1={seg.startX} y1={seg.startY} x2={seg.endX} y2={seg.endY}
                      initial={{ x2: seg.startX, y2: seg.startY }}
                      animate={{ x2: seg.endX, y2: seg.endY }}
                      transition={{ duration: 0.34, delay: 0.03, ease: [0.2, 0.96, 0.3, 1] }}
                      stroke="#a6d476"
                      strokeWidth="2.7"
                      strokeLinecap="round"
                      markerEnd={`url(#${markerId}-green)`}
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                );
              })()}

              {/* Undo preview arrow */}
              {undoHovered && lastJump && (() => {
                const seg = getJumpTrailMetrics(lastJump.to, lastJump.from, size);
                return (
                  <g>
                    <motion.line
                      x1={seg.startX} y1={seg.startY} x2={seg.endX} y2={seg.endY}
                      initial={{ x2: seg.startX, y2: seg.startY }}
                      animate={{ x2: seg.endX, y2: seg.endY }}
                      transition={{ duration: 0.26, ease: [0.2, 0.96, 0.3, 1] }}
                      stroke={theme.jumpTrailDarkRed}
                      strokeWidth="3.25"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                    <motion.line
                      x1={seg.startX} y1={seg.startY} x2={seg.endX} y2={seg.endY}
                      initial={{ x2: seg.startX, y2: seg.startY }}
                      animate={{ x2: seg.endX, y2: seg.endY }}
                      transition={{ duration: 0.31, delay: 0.03, ease: [0.2, 0.96, 0.3, 1] }}
                      stroke={theme.jumpTrailBrightRed}
                      strokeWidth="2.55"
                      strokeLinecap="round"
                      markerEnd={`url(#${markerId}-red)`}
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                );
              })()}
            </svg>

            {/* Confirm overlay */}
            {showConfirmOverlay && forcedOrigin && (
              <span
                className="pointer-events-none absolute z-[95] flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[#a7c191]/95 bg-[rgba(247,253,243,0.98)] text-[#5e7b4e] shadow-[0_14px_22px_-14px_rgba(66,89,47,0.62)]"
                style={{
                  left: `${pointPct(forcedOrigin.x, size)}%`,
                  top: `${pointPct(forcedOrigin.y, size)}%`,
                }}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5" fill="none">
                  <path d="M3.5 8.25L6.6 11.35L12.5 5.45" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            )}

            {/* Undo button */}
            {hasPending && lastJump && !completed && active && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); undoLastJump(); }}
                onPointerEnter={() => setUndoHovered(true)}
                onPointerLeave={() => setUndoHovered(false)}
                className="absolute z-[90] aspect-square -translate-x-1/2 -translate-y-1/2 bg-transparent"
                style={{
                  left: `${pointPct(lastJump.from.x, size)}%`,
                  top: `${pointPct(lastJump.from.y, size)}%`,
                  width: `${100 / size}%`,
                }}
                aria-label="Undo last jump"
              />
            )}

            {/* Undo icon */}
            {undoHovered && lastJump && (
              <span
                className="pointer-events-none absolute z-[95] flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[#deaaaa] bg-[rgba(255,247,246,0.98)] text-[#ba6561] shadow-[0_12px_20px_-14px_rgba(134,70,67,0.55)]"
                style={{
                  left: `${pointPct(lastJump.from.x, size)}%`,
                  top: `${pointPct(lastJump.from.y, size)}%`,
                }}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5" fill="none">
                  <path d="M4.25 4.25L11.75 11.75M11.75 4.25L4.25 11.75" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </span>
            )}

            {/* Nudge ring — uses margin for centering since framer-motion overrides CSS transforms */}
            {nudge && !shakePos && !completed && (
              <motion.span
                className="pointer-events-none absolute z-[85] rounded-full border-2 border-[#b98d49]"
                style={{
                  left: `${pointPct(nudge.pos.x, size)}%`,
                  top: `${pointPct(nudge.pos.y, size)}%`,
                  width: `${100 / size * 0.85}%`,
                  aspectRatio: "1",
                  marginLeft: `${-100 / size * 0.85 / 2}%`,
                  marginTop: `${-100 / size * 0.85 / 2}%`,
                }}
                animate={{
                  scale: [1, 1.25, 1],
                  opacity: [0.7, 0.25, 0.7],
                }}
                transition={{
                  duration: 1.4,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />
            )}

            {/* Mobile confirm hint — larger pulsing circle on first confirm */}
            {showMobileConfirmHint && forcedOrigin && (
              <motion.span
                className="pointer-events-none absolute z-[84] rounded-full border-[3px] border-[#56703f] bg-[#56703f]/10"
                style={{
                  left: `${pointPct(forcedOrigin.x, size)}%`,
                  top: `${pointPct(forcedOrigin.y, size)}%`,
                  width: `${100 / size * 1.3}%`,
                  aspectRatio: "1",
                  marginLeft: `${-100 / size * 1.3 / 2}%`,
                  marginTop: `${-100 / size * 1.3 / 2}%`,
                }}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{
                  scale: [1, 1.35, 1],
                  opacity: [0.8, 0.3, 0.8],
                }}
                transition={{
                  duration: 1.2,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />
            )}

            {/* Shake animation — uses margin for centering */}
            {shakePos && (
              <motion.span
                className="pointer-events-none absolute z-[85] rounded-full border-[2.5px] border-red-400 bg-red-500/10"
                style={{
                  left: `${pointPct(shakePos.x, size)}%`,
                  top: `${pointPct(shakePos.y, size)}%`,
                  width: `${100 / size * 0.75}%`,
                  aspectRatio: "1",
                  marginLeft: `${-100 / size * 0.75 / 2}%`,
                  marginTop: `${-100 / size * 0.75 / 2}%`,
                }}
                animate={{ x: [0, -4, 4, -4, 4, 0] }}
                transition={{ duration: 0.4 }}
              />
            )}

          </div>
        </div>

        {/* Nudge label — positioned below the nudge target, outside overflow-hidden */}
        {nudge && !shakePos && !completed && (() => {
          // Map nudge grid position to percentage of the board container
          // The board has p-2 padding, inner div is the grid area
          // Approximate: the board container width includes padding
          const pct = pointPct(nudge.pos.x, size);
          const topPct = pointPct(nudge.pos.y, size);
          // Scale from inner grid % to outer container % (accounting for p-2 ~ 3% each side)
          const outerLeftPct = 3 + pct * 0.94;
          const outerTopPct = 3 + (topPct + 100 / size * 0.5) * 0.94;
          return (
            <motion.div
              key={`nudge-label-${nudge.pos.x}-${nudge.pos.y}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="pointer-events-none absolute z-[96] -translate-x-1/2 whitespace-nowrap rounded-full border border-[#d7c39e] bg-[#fffaf3] px-2.5 py-0.5 text-[10px] font-semibold text-[#6c543c] shadow-md"
              style={{
                left: `${outerLeftPct}%`,
                top: `${outerTopPct}%`,
              }}
            >
              {nudge.label}
            </motion.div>
          );
        })()}

        {/* Error tooltip */}
        <AnimatePresence>
          {errorMsg && (
            <motion.div
              initial={{ opacity: 0, y: 5, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -5, scale: 0.95 }}
              className="absolute left-1/2 top-2 -translate-x-1/2 whitespace-nowrap rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 shadow-lg"
            >
              {errorMsg}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Completion checkmark — centered on the board container, above everything */}
        {completed && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 350, damping: 18 }}
            className="absolute inset-0 z-[100] flex items-center justify-center pointer-events-none"
          >
            <div className="flex h-12 w-20 items-center justify-center rounded-full bg-[#e0eef8] border-2 border-[#6ba3d6] shadow-[0_8px_24px_-6px_rgba(107,163,214,0.5)]">
              <span className="text-xl text-[#4a8ac4]">✓</span>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
