import { cn } from "@/lib/utils";
import type * as React from "react";

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: "default" | "outline" }) {
  const hasCustomBg = className?.includes("bg-");
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] shadow-xs",
        variant === "outline"
          ? "border-[#d0bb94] bg-transparent text-slate-600"
          : hasCustomBg
            ? "border-white/70 text-slate-700"
            : "border-white/70 bg-[#f0e6d4] text-slate-700",
        className,
      )}
      {...props}
    />
  );
}
