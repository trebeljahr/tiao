import type { AchievementTier } from "@shared";
import artwork from "@/lib/achievementArtwork.json";
import { cn } from "@/lib/utils";

const TIER_COLORS: Record<AchievementTier, string> = {
  bronze: "#92400e",
  silver: "#64748b",
  gold: "#ca8a04",
  platinum: "#06b6d4",
};

const ICONS: Readonly<Record<string, string>> = artwork;

export function AchievementIcon({
  id,
  tier,
  unlocked = true,
  className = "h-12 w-12",
}: {
  id: string;
  tier: AchievementTier;
  unlocked?: boolean;
  className?: string;
}) {
  const src = ICONS[id];
  if (src) {
    return (
      // biome-ignore lint/performance/noImgElement: Pre-sized WebP assets also load offline in native static exports.
      <img
        aria-hidden="true"
        alt=""
        src={src}
        width={128}
        height={128}
        draggable={false}
        className={cn("shrink-0 rounded-md object-contain", !unlocked && "grayscale", className)}
      />
    );
  }

  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke={unlocked ? TIER_COLORS[tier] : "#a89a7e"}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 9V2h12v7a6 6 0 01-12 0zM6 4H4a1 1 0 00-1 1v1a4 4 0 004 4M18 4h2a1 1 0 011 1v1a4 4 0 01-4 4M9 21h6M12 15v6" />
    </svg>
  );
}
