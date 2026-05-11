import type { GameState, Position } from "@shared";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { BoardTheme } from "./boardThemes";
import { getGhostStoneColors, getPositionKey, type gridMetrics } from "./tiaoBoardHelpers";

type MobilePreviewLayerProps = {
  mobilePreview: Position;
  mobilePreviewVisible: boolean;
  mobilePreviewDragging: boolean;
  mobilePreviewValid: boolean;
  invalidShake: { key: string; nonce: number } | null;
  theme: BoardTheme;
  m: ReturnType<typeof gridMetrics>;
  pp: (index: number) => number;
  cellPercent: number;
  currentTurn: GameState["currentTurn"];
};

export function MobilePreviewLayer({
  mobilePreview,
  mobilePreviewVisible,
  mobilePreviewDragging,
  mobilePreviewValid,
  invalidShake,
  theme,
  m,
  pp,
  cellPercent,
  currentTurn,
}: MobilePreviewLayerProps) {
  const previewKey = getPositionKey(mobilePreview);
  const shaking = invalidShake?.key === previewKey && invalidShake.nonce > 0;

  return (
    <>
      {/* Crosshair overlay */}
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

      {/* Ghost stone */}
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
            ...getGhostStoneColors(theme, mobilePreviewValid, currentTurn),
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
    </>
  );
}
