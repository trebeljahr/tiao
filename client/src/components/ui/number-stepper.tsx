import { useCallback } from "react";
import { cn } from "@/lib/utils";

type NumberStepperProps = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  unit: string;
};

export function NumberStepper({
  value,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  label,
  unit,
}: NumberStepperProps) {
  const clamp = useCallback((v: number) => Math.max(min, Math.min(max, v)), [min, max]);

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#8d7760]">{label}</p>
      <div className="flex items-center gap-2">
        <div className="flex items-center rounded-xl border border-[#d8c29c] bg-[#fffaf1] shadow-[0_8px_20px_-14px_rgba(48,31,18,0.4)]">
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-l-xl text-[#8d7760] transition-colors hover:bg-[#f0e4ce] active:bg-[#e5d6b8] disabled:opacity-30"
            onClick={() => onChange(clamp(value - step))}
            disabled={value <= min}
            aria-label={`Decrease ${label}`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          <input
            type="number"
            value={value}
            onChange={(e) => {
              const parsed = parseInt(e.target.value, 10);
              if (!isNaN(parsed)) onChange(clamp(parsed));
            }}
            min={min}
            max={max}
            className={cn(
              "h-8 w-12 border-x border-[#d8c29c] bg-transparent text-center font-mono text-base font-semibold text-[#2b1e14] outline-none",
              "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
            )}
          />
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-r-xl text-[#8d7760] transition-colors hover:bg-[#f0e4ce] active:bg-[#e5d6b8] disabled:opacity-30"
            onClick={() => onChange(clamp(value + step))}
            disabled={value >= max}
            aria-label={`Increase ${label}`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <path d="M18 15l-6-6-6 6" />
            </svg>
          </button>
        </div>
        <span className="text-sm text-[#8d7760]">{unit}</span>
      </div>
    </div>
  );
}
