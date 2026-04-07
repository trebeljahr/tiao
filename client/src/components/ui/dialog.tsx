import { useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  closeable?: boolean;
};

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  closeable = true,
}: DialogProps) {
  // Track whether the mousedown started on the backdrop (not inside the dialog content).
  // Only close when both mousedown AND mouseup (click) happen on the backdrop, so that
  // dragging text from inside the dialog to outside doesn't accidentally close it.
  const mouseDownOnBackdrop = useRef(false);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    // Lock body scroll while dialog is open
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && closeable) {
        onOpenChange(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onOpenChange, closeable]);

  const handleBackdropMouseDown = useCallback((event: React.MouseEvent) => {
    // Only flag when the mousedown target is the backdrop itself
    if (event.target === event.currentTarget) {
      mouseDownOnBackdrop.current = true;
    }
  }, []);

  const handleBackdropClick = useCallback(
    (event: React.MouseEvent) => {
      // Close only if the click target is the backdrop AND mousedown started on the backdrop
      if (event.target === event.currentTarget && mouseDownOnBackdrop.current && closeable) {
        onOpenChange(false);
      }
      mouseDownOnBackdrop.current = false;
    },
    [onOpenChange, closeable],
  );

  if (!open) {
    return null;
  }

  return (
    <motion.div
      className="fixed inset-0 z-300 flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4 backdrop-blur-xs"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onMouseDown={handleBackdropMouseDown}
      onClick={handleBackdropClick}
    >
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18 }}
        className={cn(
          "w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-[1.75rem] border border-white/70 bg-card p-6 text-card-foreground shadow-[0_34px_80px_-36px_rgba(63,37,17,0.45)]",
          className,
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-3xl font-semibold">{title}</h2>
            {description ? (
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {closeable ? (
            <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)}>
              x
            </Button>
          ) : null}
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}
