import type { Position } from "@shared";
import { AnimatePresence, motion } from "framer-motion";
import { IS_TOUCH_DEVICE } from "@/lib/isTouchDevice";
import { cn } from "@/lib/utils";

type BoardControlsProps = {
  mobilePreview: Position | null;
  mobilePreviewValid: boolean;
  disabled: boolean;
  hasPendingJump: boolean;
  zoom: {
    isZoomed: boolean;
    scale: number;
    resetZoom: () => void;
  };
  onCancelPreview: () => void;
  onConfirmPreview: (pos: Position) => void;
  onUndoLastJump?: () => void;
  onConfirmJump?: () => void;
};

export function BoardControls({
  mobilePreview,
  mobilePreviewValid,
  disabled,
  hasPendingJump,
  zoom,
  onCancelPreview,
  onConfirmPreview,
  onUndoLastJump,
  onConfirmJump,
}: BoardControlsProps) {
  const show = IS_TOUCH_DEVICE && (zoom.isZoomed || mobilePreview || (hasPendingJump && !disabled));

  return (
    <AnimatePresence>
      {show && (
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
                onClick={onCancelPreview}
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
                onClick={() => onConfirmPreview(mobilePreview)}
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
  );
}
