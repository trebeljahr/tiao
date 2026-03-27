import * as React from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  variant: _variant,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: string }) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border border-white/70 bg-white/[0.82] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-700 shadow-sm",
        className
      )}
      {...props}
    />
  );
}
