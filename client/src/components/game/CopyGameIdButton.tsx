import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { playUiFeedback } from "@/lib/uiClickAudio";
import { cn } from "@/lib/utils";

type CopyGameIdButtonProps = {
  gameId: string;
  variant?: "ghost" | "white";
  className?: string;
};

export function CopyGameIdButton({ gameId, variant = "ghost", className }: CopyGameIdButtonProps) {
  const tCommon = useTranslations("common");
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleCopy = useCallback(() => {
    // Best-effort copy — the Clipboard API throws in insecure contexts
    // (http://) and when the user denies permission. We optimistically
    // flip to "copied" and roll back on failure so the button never
    // leaves a half-confused state if the copy didn't land.
    if (!navigator.clipboard?.writeText) {
      void playUiFeedback("error");
      return;
    }
    navigator.clipboard
      .writeText(gameId)
      .then(() => {
        void playUiFeedback("success");
      })
      .catch(() => {
        setCopied(false);
        void playUiFeedback("error");
      });
    setCopied(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopied(false), 1800);
  }, [gameId]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      data-ui-feedback="manual"
      title={`Copy game ID: ${gameId}`}
      className={cn(
        "rounded-md px-1.5 py-0.5 font-mono text-[10px] transition-colors",
        variant === "white"
          ? "border border-[#e2d4b8] bg-white text-[#6e5b48] hover:bg-[#fdf6e8]"
          : "text-[#b5a48e] hover:bg-black/5 hover:text-[#6e5b48]",
        className,
      )}
    >
      {copied ? tCommon("copied") : gameId}
    </button>
  );
}
