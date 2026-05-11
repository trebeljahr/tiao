import type { GameState, Position } from "@shared";
import { motion } from "framer-motion";
import type { BoardTheme } from "./boardThemes";
import { getJumpTrailMetrics, getPositionKey, type LastMoveHighlight } from "./tiaoBoardHelpers";

type BoardArrowsLayerProps = {
  state: GameState;
  lastMove?: LastMoveHighlight;
  activeOrigin: Position | null;
  hoveredJumpTarget: Position | null;
  undoHovered: boolean;
  lastPendingJump: GameState["pendingJump"][number] | null;
  theme: BoardTheme;
  pp: (index: number) => number;
  jumpTrailMarkerId: string;
};

export function BoardArrowsLayer({
  state,
  lastMove,
  activeOrigin,
  hoveredJumpTarget,
  undoHovered,
  lastPendingJump,
  theme,
  pp,
  jumpTrailMarkerId,
}: BoardArrowsLayerProps) {
  return (
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
              initial={{ x2: segment.startX, y2: segment.startY, opacity: 0 }}
              animate={{ x2: segment.endX, y2: segment.endY, opacity: 1 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
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
              initial={{ x2: segment.startX, y2: segment.startY, opacity: 0 }}
              animate={{ x2: segment.endX, y2: segment.endY, opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.04, ease: [0.22, 1, 0.36, 1] }}
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
                  initial={{ x2: segment.startX, y2: segment.startY }}
                  animate={{ x2: segment.endX, y2: segment.endY }}
                  transition={{ duration: 0.28, ease: [0.2, 0.96, 0.3, 1] }}
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
                  initial={{ x2: segment.startX, y2: segment.startY }}
                  animate={{ x2: segment.endX, y2: segment.endY }}
                  transition={{ duration: 0.34, delay: 0.03, ease: [0.2, 0.96, 0.3, 1] }}
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
                  initial={{ x2: segment.startX, y2: segment.startY }}
                  animate={{ x2: segment.endX, y2: segment.endY }}
                  transition={{ duration: 0.26, ease: [0.2, 0.96, 0.3, 1] }}
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
                  initial={{ x2: segment.startX, y2: segment.startY }}
                  animate={{ x2: segment.endX, y2: segment.endY }}
                  transition={{ duration: 0.31, delay: 0.03, ease: [0.2, 0.96, 0.3, 1] }}
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
  );
}
