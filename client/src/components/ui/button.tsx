import * as React from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "default" | "secondary" | "outline" | "ghost" | "danger";
type ButtonSize = "default" | "sm" | "lg" | "icon";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  default:
    "bg-primary text-primary-foreground shadow-[0_18px_32px_-20px_hsl(var(--primary)/0.92)] hover:-translate-y-0.5 hover:bg-primary/[0.95] active:translate-y-0 active:shadow-[0_12px_24px_-18px_hsl(var(--primary)/0.9)]",
  secondary:
    "bg-secondary text-secondary-foreground shadow-[0_16px_28px_-22px_rgba(92,66,35,0.42)] hover:-translate-y-0.5 hover:bg-secondary/[0.92] active:translate-y-0",
  outline:
    "border border-border bg-background/[0.8] text-foreground shadow-[0_12px_24px_-24px_rgba(41,28,18,0.8)] hover:-translate-y-0.5 hover:border-primary/[0.3] hover:bg-accent/[0.4] hover:text-accent-foreground active:translate-y-0",
  ghost:
    "text-foreground hover:-translate-y-px hover:bg-accent/[0.5] hover:text-accent-foreground active:translate-y-0",
  danger:
    "bg-destructive text-destructive-foreground shadow-[0_18px_30px_-20px_hsl(var(--destructive)/0.72)] hover:-translate-y-0.5 hover:bg-destructive/[0.92] active:translate-y-0",
};

const sizeClasses: Record<ButtonSize, string> = {
  default: "h-10 px-4 py-2",
  sm: "h-8 rounded-md px-3",
  lg: "h-11 rounded-lg px-6 text-base",
  icon: "h-10 w-10",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-xl text-sm font-semibold transition-all duration-200 disabled:pointer-events-none disabled:opacity-50",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";
