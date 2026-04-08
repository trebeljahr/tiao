import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
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
    void navigator.clipboard.writeText(gameId);
    setCopied(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopied(false), 1800);
  }, [gameId]);

  return (
    <button
      type="button"
      onClick={handleCopy}
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
