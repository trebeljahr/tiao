import { AchievementIcon } from "@/components/AchievementIcon";
import type { AchievementDefinition, AchievementTier } from "@shared";

// ---------------------------------------------------------------------------
// Tier styling — shared between AchievementsPage and the profile page so the
// two surfaces always look identical.
// ---------------------------------------------------------------------------

export const TIER_STYLES: Record<
  AchievementTier,
  { bg: string; border: string; icon: string; glow: string }
> = {
  bronze: {
    bg: "from-amber-800/20 to-orange-900/10",
    border: "border-amber-700/40",
    icon: "text-amber-700",
    glow: "",
  },
  silver: {
    bg: "from-slate-300/30 to-slate-400/10",
    border: "border-slate-400/50",
    icon: "text-slate-500",
    glow: "",
  },
  gold: {
    bg: "from-yellow-400/25 to-amber-500/10",
    border: "border-yellow-500/50",
    icon: "text-yellow-600",
    glow: "shadow-[0_0_12px_rgba(234,179,8,0.25)]",
  },
  platinum: {
    bg: "from-cyan-300/20 to-purple-400/15",
    border: "border-cyan-400/50",
    icon: "text-cyan-500",
    glow: "shadow-[0_0_16px_rgba(6,182,212,0.3)]",
  },
};

export const TIER_LABELS: Record<AchievementTier, string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
};

const TIER_RIBBON: Record<AchievementTier, string> = {
  bronze: "bg-amber-700/20 text-amber-800",
  silver: "bg-slate-400/20 text-slate-600",
  gold: "bg-yellow-500/20 text-yellow-700",
  platinum: "bg-cyan-500/20 text-cyan-700",
};

export function AchievementCard({
  def,
  unlocked,
  unlockedAt,
}: {
  def: AchievementDefinition;
  unlocked: boolean;
  unlockedAt?: string;
}) {
  const isHidden = def.secret && !unlocked;
  const tier = TIER_STYLES[def.tier];

  return (
    <div
      id={`achievement-${def.id}`}
      className={`relative scroll-mt-24 overflow-hidden rounded-xl border bg-gradient-to-br p-4 transition-all duration-300 ${
        unlocked
          ? `${tier.bg} ${tier.border} ${tier.glow}`
          : "border-[#d5c4a8]/40 from-[#e8dcc8]/30 to-[#ddd0b8]/10 opacity-50 grayscale"
      }`}
    >
      {/* Tier ribbon */}
      {unlocked && (
        <div
          className={`absolute right-0 top-0 rounded-bl-lg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${TIER_RIBBON[def.tier]}`}
        >
          {TIER_LABELS[def.tier]}
        </div>
      )}

      <div className="flex items-start gap-3">
        {/* Icon */}
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-xl ${
            unlocked ? `bg-white/40 ${tier.icon}` : "bg-[#c8b99a]/20 text-[#a89a7e]"
          }`}
        >
          {isHidden ? (
            <span className="text-lg">{"\ud83d\udd12"}</span>
          ) : (
            <AchievementIcon id={def.id} tier={def.tier} unlocked={unlocked} />
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <h3
            className={`text-sm font-semibold leading-tight ${
              unlocked ? "text-[#2b1e14]" : "text-[#8d7760]"
            }`}
          >
            {isHidden ? "???" : def.name}
          </h3>
          <p
            className={`mt-0.5 text-xs leading-snug ${
              unlocked ? "text-[#5a4632]" : "text-[#a89a7e]"
            }`}
          >
            {isHidden ? "This is a secret achievement." : def.description}
          </p>
          {unlocked && unlockedAt && (
            <p className="mt-1 text-[10px] text-[#8d7760]">
              Unlocked {new Date(unlockedAt).toLocaleDateString()}
            </p>
          )}
        </div>

        {/* Unlocked checkmark */}
        {unlocked && (
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/20">
            <svg
              className="h-3.5 w-3.5 text-emerald-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={3}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}
