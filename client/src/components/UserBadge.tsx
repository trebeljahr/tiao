import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Badge definitions
// ---------------------------------------------------------------------------

export type BadgeId =
  | "supporter"
  | "contributor"
  | "super-supporter"
  | "official-champion"
  | "creator"
  | "badge-1"
  | "badge-2"
  | "badge-3"
  | "badge-4"
  | "badge-5"
  | "badge-6"
  | "badge-7"
  | "badge-8";

type BadgeTier = 1 | 2 | 3;

type BadgeDefinition = {
  id: BadgeId;
  label: string;
  tier: BadgeTier;
  /** CSS gradient for the pill background. */
  gradient: string;
  /** Text color. */
  textColor: string;
  /** Static box-shadow glow (tier 1+). */
  glow: string;
};

export const BADGE_DEFINITIONS: Record<BadgeId, BadgeDefinition> = {
  supporter: {
    id: "supporter",
    label: "Supporter",
    tier: 1,
    gradient: "linear-gradient(135deg, #d4a644, #c4912e)",
    textColor: "#fff",
    glow: "0 0 8px rgba(212, 166, 68, 0.35), inset 0 1px 2px rgba(255, 255, 255, 0.25)",
  },
  contributor: {
    id: "contributor",
    label: "Contributor",
    tier: 1,
    gradient: "linear-gradient(135deg, #2aa89a, #1e8a7e)",
    textColor: "#fff",
    glow: "0 0 8px rgba(42, 168, 154, 0.35), inset 0 1px 2px rgba(255, 255, 255, 0.25)",
  },
  "super-supporter": {
    id: "super-supporter",
    label: "Super Supporter",
    tier: 2,
    gradient: "linear-gradient(90deg, #d4a644, #e8c05a, #d4a644)",
    textColor: "#fff",
    glow: "0 0 10px rgba(212, 166, 68, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.3)",
  },
  "official-champion": {
    id: "official-champion",
    label: "Champion",
    tier: 2,
    gradient: "linear-gradient(90deg, #7c3aed, #a855f7, #7c3aed)",
    textColor: "#fff",
    glow: "0 0 10px rgba(124, 58, 237, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.3)",
  },
  creator: {
    id: "creator",
    label: "Creator",
    tier: 3,
    gradient: "linear-gradient(90deg, #ff6b6b, #feca57, #48dbfb, #ff9ff3, #54a0ff, #ff6b6b)",
    textColor: "#fff",
    glow: "0 0 8px rgba(255, 107, 107, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.3)",
  },
  // ─── Experimental badge designs ──────────────────────────────────
  "badge-1": {
    id: "badge-1",
    label: "Supporter",
    tier: 1,
    gradient: "linear-gradient(135deg, #e8836b, #d4644a)",
    textColor: "#fff",
    glow: "0 0 8px rgba(232, 131, 107, 0.35), inset 0 1px 2px rgba(255, 255, 255, 0.25)",
  },
  "badge-2": {
    id: "badge-2",
    label: "Supporter",
    tier: 1,
    gradient: "linear-gradient(135deg, #6366f1, #4f46e5)",
    textColor: "#fff",
    glow: "0 0 8px rgba(99, 102, 241, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.25)",
  },
  "badge-3": {
    id: "badge-3",
    label: "Supporter",
    tier: 2,
    gradient: "linear-gradient(90deg, #f472b6, #ec4899, #f472b6)",
    textColor: "#fff",
    glow: "0 0 10px rgba(236, 72, 153, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.3)",
  },
  "badge-4": {
    id: "badge-4",
    label: "Supporter",
    tier: 2,
    gradient: "linear-gradient(90deg, #14b8a6, #06b6d4, #14b8a6)",
    textColor: "#fff",
    glow: "0 0 10px rgba(20, 184, 166, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.3)",
  },
  "badge-5": {
    id: "badge-5",
    label: "Supporter",
    tier: 1,
    gradient: "linear-gradient(135deg, #78716c, #57534e)",
    textColor: "#fafaf9",
    glow: "0 0 6px rgba(120, 113, 108, 0.3), inset 0 1px 2px rgba(255, 255, 255, 0.2)",
  },
  "badge-6": {
    id: "badge-6",
    label: "Supporter",
    tier: 2,
    gradient: "linear-gradient(90deg, #f59e0b, #ef4444, #f59e0b)",
    textColor: "#fff",
    glow: "0 0 10px rgba(245, 158, 11, 0.5), inset 0 1px 2px rgba(255, 255, 255, 0.3)",
  },
  "badge-7": {
    id: "badge-7",
    label: "Supporter",
    tier: 3,
    gradient: "linear-gradient(90deg, #c084fc, #818cf8, #22d3ee, #34d399, #fbbf24, #c084fc)",
    textColor: "#fff",
    glow: "0 0 12px rgba(192, 132, 252, 0.5), inset 0 1px 2px rgba(255, 255, 255, 0.3)",
  },
  "badge-8": {
    id: "badge-8",
    label: "Supporter",
    tier: 2,
    gradient: "linear-gradient(90deg, #1e3a5f, #2563eb, #1e3a5f)",
    textColor: "#93c5fd",
    glow: "0 0 10px rgba(37, 99, 235, 0.4), inset 0 1px 2px rgba(147, 197, 253, 0.2)",
  },
};

export const ALL_BADGE_IDS = Object.keys(BADGE_DEFINITIONS) as BadgeId[];

// ---------------------------------------------------------------------------
// Keyframe styles (injected once)
// ---------------------------------------------------------------------------

let stylesInjected = false;

function injectBadgeStyles() {
  if (stylesInjected || typeof document === "undefined") return;
  stylesInjected = true;

  const style = document.createElement("style");
  style.textContent = `
    @keyframes badge-shimmer {
      0% { background-position: -200% center; }
      100% { background-position: 200% center; }
    }
    @keyframes badge-rainbow {
      0% { filter: hue-rotate(0deg); }
      100% { filter: hue-rotate(360deg); }
    }
    @keyframes badge-glow-pulse {
      0%, 100% { box-shadow: 0 0 6px rgba(255,150,200,0.45), inset 0 1px 2px rgba(255,255,255,0.3); }
      50% { box-shadow: 0 0 16px rgba(255,150,200,0.7), inset 0 1px 2px rgba(255,255,255,0.3); }
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type UserBadgeProps = {
  badge: BadgeId;
  className?: string;
  /** Compact mode for tight layouts (smaller text). */
  compact?: boolean;
};

const BADGE_TRANSLATION_KEY: Record<BadgeId, string> = {
  supporter: "supporter",
  contributor: "contributor",
  "super-supporter": "superSupporter",
  "official-champion": "champion",
  creator: "creator",
  "badge-1": "supporter",
  "badge-2": "supporter",
  "badge-3": "supporter",
  "badge-4": "supporter",
  "badge-5": "supporter",
  "badge-6": "supporter",
  "badge-7": "supporter",
  "badge-8": "supporter",
};

export function UserBadge({ badge, className, compact = false }: UserBadgeProps) {
  const t = useTranslations("badges");
  const def = BADGE_DEFINITIONS[badge];
  if (!def) return null;

  injectBadgeStyles();

  const isShimmer = def.tier >= 2;
  const isRainbow = def.tier === 3;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full font-bold uppercase tracking-wider",
        compact ? "px-1.5 py-[1px] text-[8px]" : "px-2 py-0.5 text-[10px]",
        className,
      )}
      style={{
        background: def.gradient,
        backgroundSize: isShimmer ? "200% 100%" : undefined,
        color: def.textColor,
        boxShadow: def.glow,
        animation: isRainbow
          ? "badge-rainbow 4s linear infinite, badge-glow-pulse 2s ease-in-out infinite"
          : isShimmer
            ? "badge-shimmer 3s ease-in-out infinite"
            : undefined,
        textShadow: "0 1px 2px rgba(0,0,0,0.2)",
      }}
    >
      {t(BADGE_TRANSLATION_KEY[badge])}
    </span>
  );
}
