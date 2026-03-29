import * as React from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: "default" | "outline" }) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] shadow-sm",
        variant === "outline"
          ? "border-[#d0bb94] bg-transparent text-slate-600"
          : "border-white/70 bg-[#f0e6d4] text-slate-700",
        className,
      )}
      {...props}
    />
  );
}
