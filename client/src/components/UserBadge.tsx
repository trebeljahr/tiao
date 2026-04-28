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
  | "badge-8"
  // Achievement-earned badges
  | "veteran"
  | "top-one-percent"
  | "tournament-champion"
  | "one-jump-wonder"
  | "flawless-victory"
  | "one-second-glory"
  | "david-vs-goliath"
  // Subscription badges
  | "patron";

type BadgeTier = 1 | 2 | 3;

type BadgeDefinition = {
  id: BadgeId;
  /** next-intl key under "badges.*" for the localized display name. */
  nameKey: string;
  /** next-intl key under "badges.*" for the localized one-line description. */
  descKey: string;
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
    nameKey: "supporter",
    descKey: "supporterDesc",
    tier: 1,
    gradient: "linear-gradient(135deg, #d4a644, #c4912e)",
    textColor: "#fff",
    glow: "0 0 8px rgba(212, 166, 68, 0.35), inset 0 1px 2px rgba(255, 255, 255, 0.25)",
  },
  contributor: {
    id: "contributor",
    nameKey: "contributor",
    descKey: "contributorDesc",
    tier: 1,
    gradient: "linear-gradient(135deg, #2aa89a, #1e8a7e)",
    textColor: "#fff",
    glow: "0 0 8px rgba(42, 168, 154, 0.35), inset 0 1px 2px rgba(255, 255, 255, 0.25)",
  },
  "super-supporter": {
    id: "super-supporter",
    nameKey: "superSupporter",
    descKey: "superSupporterDesc",
    tier: 2,
    gradient: "linear-gradient(90deg, #d4a644, #e8c05a, #d4a644)",
    textColor: "#fff",
    glow: "0 0 10px rgba(212, 166, 68, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.3)",
  },
  "official-champion": {
    id: "official-champion",
    nameKey: "champion",
    descKey: "championDesc",
    tier: 2,
    gradient: "linear-gradient(90deg, #7c3aed, #a855f7, #7c3aed)",
    textColor: "#fff",
    glow: "0 0 10px rgba(124, 58, 237, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.3)",
  },
  creator: {
    id: "creator",
    nameKey: "creator",
    descKey: "creatorDesc",
    tier: 3,
    gradient: "linear-gradient(90deg, #ff6b6b, #feca57, #48dbfb, #ff9ff3, #54a0ff, #ff6b6b)",
    textColor: "#fff",
    glow: "0 0 8px rgba(255, 107, 107, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.3)",
  },
  // ─── Supporter color variants ────────────────────────────────────
  // All reuse the "supporter" localization key — they differ only in
  // the visual gradient. Stripe line items get distinct names via
  // `stripeName` on the shop catalog so receipts remain intelligible.
  "badge-1": {
    id: "badge-1",
    nameKey: "supporter",
    descKey: "supporterDesc",
    tier: 1,
    gradient: "linear-gradient(135deg, #e8836b, #d4644a)",
    textColor: "#fff",
    glow: "0 0 8px rgba(232, 131, 107, 0.35), inset 0 1px 2px rgba(255, 255, 255, 0.25)",
  },
  "badge-2": {
    id: "badge-2",
    nameKey: "supporter",
    descKey: "supporterDesc",
    tier: 1,
    gradient: "linear-gradient(135deg, #6366f1, #4f46e5)",
    textColor: "#fff",
    glow: "0 0 8px rgba(99, 102, 241, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.25)",
  },
  "badge-3": {
    id: "badge-3",
    nameKey: "supporter",
    descKey: "supporterDesc",
    tier: 2,
    gradient: "linear-gradient(90deg, #f472b6, #ec4899, #f472b6)",
    textColor: "#fff",
    glow: "0 0 10px rgba(236, 72, 153, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.3)",
  },
  "badge-4": {
    id: "badge-4",
    nameKey: "supporter",
    descKey: "supporterDesc",
    tier: 2,
    gradient: "linear-gradient(90deg, #14b8a6, #06b6d4, #14b8a6)",
    textColor: "#fff",
    glow: "0 0 10px rgba(20, 184, 166, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.3)",
  },
  "badge-5": {
    id: "badge-5",
    nameKey: "supporter",
    descKey: "supporterDesc",
    tier: 1,
    gradient: "linear-gradient(135deg, #78716c, #57534e)",
    textColor: "#fafaf9",
    glow: "0 0 6px rgba(120, 113, 108, 0.3), inset 0 1px 2px rgba(255, 255, 255, 0.2)",
  },
  "badge-6": {
    id: "badge-6",
    nameKey: "supporter",
    descKey: "supporterDesc",
    tier: 2,
    gradient: "linear-gradient(90deg, #f59e0b, #ef4444, #f59e0b)",
    textColor: "#fff",
    glow: "0 0 10px rgba(245, 158, 11, 0.5), inset 0 1px 2px rgba(255, 255, 255, 0.3)",
  },
  "badge-7": {
    id: "badge-7",
    nameKey: "supporter",
    descKey: "supporterDesc",
    tier: 3,
    gradient: "linear-gradient(90deg, #c084fc, #818cf8, #22d3ee, #34d399, #fbbf24, #c084fc)",
    textColor: "#fff",
    glow: "0 0 12px rgba(192, 132, 252, 0.5), inset 0 1px 2px rgba(255, 255, 255, 0.3)",
  },
  "badge-8": {
    id: "badge-8",
    nameKey: "supporter",
    descKey: "supporterDesc",
    tier: 2,
    gradient: "linear-gradient(90deg, #1e3a5f, #2563eb, #1e3a5f)",
    textColor: "#93c5fd",
    glow: "0 0 10px rgba(37, 99, 235, 0.4), inset 0 1px 2px rgba(147, 197, 253, 0.2)",
  },
  // ─── Achievement-earned badges ──────────────────────────────────
  veteran: {
    id: "veteran",
    nameKey: "veteran",
    descKey: "veteranDesc",
    tier: 2,
    gradient: "linear-gradient(90deg, #6b7280, #9ca3af, #6b7280)",
    textColor: "#fff",
    glow: "0 0 10px rgba(107, 114, 128, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.3)",
  },
  "top-one-percent": {
    id: "top-one-percent",
    nameKey: "topOnePercent",
    descKey: "topOnePercentDesc",
    tier: 3,
    gradient: "linear-gradient(90deg, #fbbf24, #f59e0b, #ef4444, #fbbf24)",
    textColor: "#fff",
    glow: "0 0 12px rgba(251, 191, 36, 0.5), inset 0 1px 2px rgba(255, 255, 255, 0.3)",
  },
  "tournament-champion": {
    id: "tournament-champion",
    nameKey: "tournamentChampion",
    descKey: "tournamentChampionDesc",
    tier: 2,
    gradient: "linear-gradient(90deg, #a855f7, #7c3aed, #a855f7)",
    textColor: "#fff",
    glow: "0 0 10px rgba(168, 85, 247, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.3)",
  },
  "one-jump-wonder": {
    id: "one-jump-wonder",
    nameKey: "oneJumpWonder",
    descKey: "oneJumpWonderDesc",
    tier: 2,
    gradient: "linear-gradient(90deg, #10b981, #34d399, #10b981)",
    textColor: "#fff",
    glow: "0 0 10px rgba(16, 185, 129, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.3)",
  },
  "flawless-victory": {
    id: "flawless-victory",
    nameKey: "flawlessVictory",
    descKey: "flawlessVictoryDesc",
    tier: 2,
    gradient: "linear-gradient(90deg, #e2e8f0, #f8fafc, #e2e8f0)",
    textColor: "#334155",
    glow: "0 0 10px rgba(226, 232, 240, 0.5), inset 0 1px 2px rgba(255, 255, 255, 0.5)",
  },
  "one-second-glory": {
    id: "one-second-glory",
    nameKey: "oneSecondGlory",
    descKey: "oneSecondGloryDesc",
    tier: 2,
    gradient: "linear-gradient(90deg, #ef4444, #f97316, #ef4444)",
    textColor: "#fff",
    glow: "0 0 10px rgba(239, 68, 68, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.3)",
  },
  "david-vs-goliath": {
    id: "david-vs-goliath",
    nameKey: "davidVsGoliath",
    descKey: "davidVsGoliathDesc",
    tier: 1,
    gradient: "linear-gradient(135deg, #3b82f6, #1d4ed8)",
    textColor: "#fff",
    glow: "0 0 8px rgba(59, 130, 246, 0.35), inset 0 1px 2px rgba(255, 255, 255, 0.25)",
  },
  // ─── Subscription badges ────────────────────────────────────────
  patron: {
    id: "patron",
    nameKey: "patron",
    descKey: "patronDesc",
    tier: 2,
    gradient: "linear-gradient(90deg, #d97706, #f59e0b, #d97706)",
    textColor: "#fff",
    glow: "0 0 10px rgba(217, 119, 6, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.3)",
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
    @keyframes badge-patron-pulse {
      0%, 100% { box-shadow: 0 0 8px rgba(217,119,6,0.35), inset 0 1px 2px rgba(255,255,255,0.3); }
      50% { box-shadow: 0 0 16px rgba(245,158,11,0.6), inset 0 1px 2px rgba(255,255,255,0.3); }
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

/**
 * Hook — resolves a badge id to its localized display name.
 * Prefer this over reaching into `BADGE_DEFINITIONS[id].nameKey` directly
 * so every call-site gets the same lookup path.
 */
export function useBadgeName(id: BadgeId): string {
  const t = useTranslations("badges");
  const def = BADGE_DEFINITIONS[id];
  if (!def) return id;
  return t(def.nameKey);
}

/** Hook — resolves a badge id to its localized one-line description. */
export function useBadgeDescription(id: BadgeId): string {
  const t = useTranslations("badges");
  const def = BADGE_DEFINITIONS[id];
  if (!def) return "";
  return t(def.descKey);
}

/** Pure helper for callers that already have a next-intl translator bound. */
export function getBadgeNameKey(id: BadgeId): string | undefined {
  return BADGE_DEFINITIONS[id]?.nameKey;
}

/** Pure helper for callers that already have a next-intl translator bound. */
export function getBadgeDescriptionKey(id: BadgeId): string | undefined {
  return BADGE_DEFINITIONS[id]?.descKey;
}

export function UserBadge({ badge, className, compact = false }: UserBadgeProps) {
  const t = useTranslations("badges");
  const def = BADGE_DEFINITIONS[badge];
  if (!def) return null;

  injectBadgeStyles();

  const isPatron = badge === "patron";
  const isShimmer = def.tier >= 2;
  const isRainbow = def.tier === 3;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full font-bold uppercase tracking-wider",
        compact ? "px-1.5 py-px text-[8px]" : "px-2 py-0.5 text-[10px]",
        className,
      )}
      style={{
        background: def.gradient,
        backgroundSize: isShimmer ? "200% 100%" : undefined,
        color: def.textColor,
        boxShadow: def.glow,
        animation: isPatron
          ? "badge-shimmer 3s ease-in-out infinite, badge-patron-pulse 2.5s ease-in-out infinite"
          : isRainbow
            ? "badge-rainbow 4s linear infinite, badge-glow-pulse 2s ease-in-out infinite"
            : isShimmer
              ? "badge-shimmer 3s ease-in-out infinite"
              : undefined,
        textShadow: "0 1px 2px rgba(0,0,0,0.2)",
      }}
    >
      {t(def.nameKey)}
    </span>
  );
}
