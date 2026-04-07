import { cn } from "@/lib/utils";

/**
 * Pure-CSS fade+slide-up entrance animation. No JS hydration needed —
 * the animation runs from the server-rendered HTML via CSS @keyframes.
 */
export function AnimatedCard({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("animate-card-in", className)}
      style={delay > 0 ? { animationDelay: `${delay}s` } : undefined}
    >
      {children}
    </div>
  );
}
