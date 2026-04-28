import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => {
  return (
    <input
      ref={ref}
      className={cn(
        "flex h-11 w-full rounded-2xl border border-border bg-background/92 px-4 py-2 text-sm text-foreground shadow-[0_16px_30px_-26px_rgba(48,31,18,0.8)] transition-colors",
        "placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "user-invalid:border-red-400 user-invalid:ring-1 user-invalid:ring-red-200 user-invalid:focus-visible:ring-red-300",
        className,
      )}
      {...props}
    />
  );
});

Input.displayName = "Input";
