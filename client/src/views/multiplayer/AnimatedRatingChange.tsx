import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export function AnimatedEllipsis() {
  const [dots, setDots] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setDots((d) => (d + 1) % 4), 500);
    return () => clearInterval(interval);
  }, []);
  return <span className="inline-block w-[1.5em] text-left">{".".repeat(dots)}</span>;
}

type AnimatedRatingChangeProps = {
  label: string;
  before: number;
  after: number;
  delta: number;
};

/** Counting-up animation from `before` to `after` with a bounce at the end. */
export function AnimatedRatingChange({ label, before, after, delta }: AnimatedRatingChangeProps) {
  const [displayValue, setDisplayValue] = useState(Math.round(before));
  const [animDone, setAnimDone] = useState(false);

  useEffect(() => {
    const start = Math.round(before);
    const end = Math.round(after);
    if (start === end) {
      setDisplayValue(end);
      setAnimDone(true);
      return;
    }

    const totalSteps = Math.min(Math.abs(end - start), 30);
    const duration = 800; // ms
    const stepDuration = duration / totalSteps;
    let step = 0;

    const timer = setInterval(() => {
      step++;
      // Ease-out: start fast, slow down at end
      const progress = step / totalSteps;
      const eased = 1 - (1 - progress) ** 3;
      const current = Math.round(start + (end - start) * eased);
      setDisplayValue(current);

      if (step >= totalSteps) {
        clearInterval(timer);
        setDisplayValue(end);
        setAnimDone(true);
      }
    }, stepDuration);

    return () => clearInterval(timer);
  }, [before, after]);

  const roundedDelta = Math.round(delta);

  return (
    <div className="flex items-center justify-start gap-3 py-2 mb-2">
      <span className="text-sm text-[#6e5b48]">{label}:</span>
      <span
        className={cn(
          "font-display text-2xl font-bold text-[#2b1e14]",
          animDone && "animate-rating-pop",
        )}
      >
        {displayValue}
      </span>
      {roundedDelta !== 0 && (
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-bold",
            roundedDelta > 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600",
            animDone ? "animate-rating-delta-in" : "opacity-0 scale-50",
          )}
        >
          {roundedDelta > 0 ? "+" : ""}
          {roundedDelta}
        </span>
      )}
    </div>
  );
}
