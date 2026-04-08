import type { AchievementTier } from "@shared";

const TIER_COLORS: Record<AchievementTier, string> = {
  bronze: "#92400e",
  silver: "#64748b",
  gold: "#ca8a04",
  platinum: "#06b6d4",
};

const MUTED = "#a89a7e";

type IconProps = { color: string };

// ---------------------------------------------------------------------------
// Per-achievement SVG path data (24x24 viewBox, stroke-based)
// ---------------------------------------------------------------------------

function FootstepIcon({ color }: IconProps) {
  return (
    <>
      {/* Left shoe print */}
      <path
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 14.5c0-1.5.8-2.8 2-3.5.5-.3 1-.4 1.5-.4 1.7 0 3 1.6 3 3.5S10 18 8.5 18 5 16.5 5 14.5z"
      />
      <ellipse cx="8" cy="9" rx="1.5" ry="2" stroke={color} fill="none" />
      {/* Right shoe print */}
      <path
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12.5 8.5c0-1.5.8-2.8 2-3.5.5-.3 1-.4 1.5-.4 1.7 0 3 1.6 3 3.5s-1.3 3.5-2.8 3.5S12.5 10.5 12.5 8.5z"
      />
      <ellipse cx="15.5" cy="3.5" rx="1.5" ry="2" stroke={color} fill="none" />
    </>
  );
}

function BarChartIcon({ color }: IconProps) {
  return (
    <>
      <path
        stroke={color}
        strokeLinecap="round"
        strokeWidth={2}
        d="M6 20V14M10 20V10M14 20V6M18 20V3"
      />
      <path stroke={color} strokeLinecap="round" d="M3 20h18" />
    </>
  );
}

function CoffeeIcon({ color }: IconProps) {
  return (
    <path
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M5 8h12a2 2 0 012 2v2a2 2 0 01-2 2h-1M5 8v6a4 4 0 004 4h2a4 4 0 004-4V8M5 8H3M8 3v2M12 3v2M16 3v2M5 20h14"
    />
  );
}

function HelmetIcon({ color }: IconProps) {
  return (
    <path
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M4 14c0-4.4 3.6-8 8-8s8 3.6 8 8M4 14h16M4 14v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 6V3M8 14v-2a4 4 0 018 0v2"
    />
  );
}

function MedalStarIcon({ color }: IconProps) {
  return (
    <path
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 2l2.4 4.8 5.3.8-3.8 3.7.9 5.3L12 14.2l-4.8 2.4.9-5.3L4.3 7.6l5.3-.8L12 2zM8 18l-2 4M16 18l2 4"
    />
  );
}

function FallingIcon({ color }: IconProps) {
  return (
    <path
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 3a2 2 0 100 4 2 2 0 000-4zM10 9l-3 5M14 9l3 3M9 14l-2 7M15 12l2 9M11 14h2"
    />
  );
}

function TombstoneIcon({ color }: IconProps) {
  return (
    <>
      <path
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 22V10a6 6 0 0112 0v12"
      />
      <path stroke={color} strokeLinecap="round" d="M6 22h12" />
      <path stroke={color} strokeLinecap="round" d="M12 12v4M10 14h4" />
      <path stroke={color} strokeLinecap="round" d="M4 22h16" />
    </>
  );
}

function BoxingGloveIcon({ color }: IconProps) {
  // Based on Iconoir boxing-glove icon (MIT license)
  return (
    <>
      <path
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.49 17.73H18.36M8.49 17.73V21H18.36V17.73M8.49 17.73C5.2 15.55 3.56 10.09 4.1 8.45C4.54 7.15 6.48 7.55 7.39 7.91C7.39 4.09 9.04 3 13.42 3C17.81 3 20 4.09 20 9.55C20 13.91 18.9 16.82 18.36 17.73"
      />
      <path
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7.39 7.91C7.76 8.27 8.82 9 10.13 9C11.45 9 13.97 9 15.07 9"
      />
      <path
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7.39 7.91C7.39 11.73 9.04 12.27 10.13 12.27"
      />
    </>
  );
}

function BabyBottleIcon({ color }: IconProps) {
  return (
    <path
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M10 2h4v3l2 2v10a3 3 0 01-3 3h-2a3 3 0 01-3-3V7l2-2V2zM8 10h8M8 14h8"
    />
  );
}

function RobotIcon({ color }: IconProps) {
  return (
    <>
      <rect x="4" y="8" width="16" height="12" rx="3" stroke={color} fill="none" />
      <path stroke={color} strokeLinecap="round" d="M12 8V5" />
      <circle cx="12" cy="4" r="1.5" stroke={color} fill="none" />
      <rect x="7.5" y="12" width="3" height="2.5" rx="0.5" stroke={color} fill="none" />
      <rect x="13.5" y="12" width="3" height="2.5" rx="0.5" stroke={color} fill="none" />
      <path stroke={color} strokeLinecap="round" d="M9.5 17.5h5" />
      <path stroke={color} strokeLinecap="round" d="M1 13h3M20 13h3" />
    </>
  );
}

function SkullIcon({ color }: IconProps) {
  return (
    <path
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 2a8 8 0 00-8 8c0 2.5 1.2 4.8 3 6.2V19a1 1 0 001 1h8a1 1 0 001-1v-2.8c1.8-1.4 3-3.7 3-6.2a8 8 0 00-8-8zM9 12a1 1 0 100 2 1 1 0 000-2zM15 12a1 1 0 100 2 1 1 0 000-2zM10 20v1M14 20v1"
    />
  );
}

function FlameIcon({ color }: IconProps) {
  return (
    <>
      {/* Outer flame — wide and rounded like the fire emoji */}
      <path
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 2C10 6 5 8 5 14a7 7 0 0014 0c0-6-5-8-7-12z"
      />
      {/* Inner flame */}
      <path
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 10c-1 2-3 3-3 6a3 3 0 006 0c0-3-2-4-3-6z"
      />
    </>
  );
}

function BellIcon({ color }: IconProps) {
  return (
    <path
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9zM13.73 21a2 2 0 01-3.46 0M1 3l2 2M23 3l-2 2M21 8h1M2 8h1"
    />
  );
}

function HourglassIcon({ color }: IconProps) {
  return (
    <path
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M6 2h12M6 22h12M7 2v4l5 5 5-5V2M7 22v-4l5-5 5 5v4"
    />
  );
}

function TwoPeopleIcon({ color }: IconProps) {
  return (
    <path
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"
    />
  );
}

function ButterflyIcon({ color }: IconProps) {
  return (
    <>
      {/* Left wings */}
      <path
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 12C9 9 4 8 3 11s2 5 5 5c1.5 0 3-1 4-4z"
      />
      <path
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 12C10 10 6 6 4 7s0 5 3 6c1.5.5 3.5 0 5-1z"
      />
      {/* Right wings */}
      <path
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 12c3-3 8-4 9-1s-2 5-5 5c-1.5 0-3-1-4-4z"
      />
      <path
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 12c2-2 6-6 8-5s0 5-3 6c-1.5.5-3.5 0-5-1z"
      />
      {/* Body */}
      <path stroke={color} strokeLinecap="round" d="M12 9v10" />
      {/* Antennae */}
      <path stroke={color} strokeLinecap="round" d="M12 9l-2-4M12 9l2-4" />
    </>
  );
}

function CrownIcon({ color }: IconProps) {
  return (
    <path
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M2 8l4 12h12l4-12-5 4-5-8-5 8-5-4zM6 20h12"
    />
  );
}

function VikingHelmetIcon({ color }: IconProps) {
  return (
    <>
      <path
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 14c0-3.9 3.1-7 7-7s7 3.1 7 7"
      />
      <path stroke={color} strokeLinecap="round" d="M4 14h16" />
      <path stroke={color} strokeLinecap="round" strokeLinejoin="round" d="M5 14v3h14v-3" />
      <path stroke={color} strokeLinecap="round" d="M9 17v2M15 17v2" />
      <path
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 12c-2-3-3-7-1-10M19 12c2-3 3-7 1-10"
      />
    </>
  );
}

function GradCapIcon({ color }: IconProps) {
  return (
    <path
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M2 10l10-5 10 5-10 5-10-5zM6 12v5c0 1 2.7 3 6 3s6-2 6-3v-5M22 10v6"
    />
  );
}

function BinocularsIcon({ color }: IconProps) {
  return (
    <>
      {/* Left barrel */}
      <rect x="2" y="8" width="8" height="12" rx="4" stroke={color} fill="none" />
      {/* Right barrel */}
      <rect x="14" y="8" width="8" height="12" rx="4" stroke={color} fill="none" />
      {/* Bridge connecting the two barrels */}
      <path stroke={color} strokeLinecap="round" d="M10 13h4" />
      {/* Left lens */}
      <ellipse cx="6" cy="8" rx="4" ry="2" stroke={color} fill="none" />
      {/* Right lens */}
      <ellipse cx="18" cy="8" rx="4" ry="2" stroke={color} fill="none" />
    </>
  );
}

function DoorExitIcon({ color }: IconProps) {
  return (
    <path
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"
    />
  );
}

function MoonIcon({ color }: IconProps) {
  return (
    <>
      <path
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"
      />
      <path stroke={color} strokeLinecap="round" d="M15.5 6l.5 1 1-.5M18 10.5l.5.5" />
    </>
  );
}

function RocketIcon({ color }: IconProps) {
  return (
    <path
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 2c-2 4-3 7-3 10a3 3 0 006 0c0-3-1-6-3-10zM9 12H5l2 4M15 12h4l-2 4M9 22c0-2 1-3 3-4 2 1 3 2 3 4"
    />
  );
}

function RisingArrowIcon({ color }: IconProps) {
  return (
    <path
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3 20L9 8l4 6 8-12M17 2h4v4"
    />
  );
}

function DiamondIcon({ color }: IconProps) {
  return (
    <path
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M6 3h12l4 7-10 12L2 10l4-7zM2 10h20M12 22L8 10M12 22l4-12M6 3l2 7M18 3l-2 7M12 3v7"
    />
  );
}

function DavidGoliathIcon({ color }: IconProps) {
  return (
    <>
      {/* Goliath — tall & bulky */}
      <circle cx="17" cy="4" r="2" stroke={color} fill="none" />
      <path
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M17 6v6M14 9h6M14 12v7l1 2M20 12v7l-1 2"
      />
      {/* David — small */}
      <circle cx="7" cy="9" r="1.5" stroke={color} fill="none" />
      <path
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7 10.5v4M5 12.5h4M5 14.5v4.5l.5 1M9 14.5v4.5l-.5 1"
      />
      {/* Clash line between them */}
      <path stroke={color} strokeLinecap="round" strokeDasharray="1.5 1.5" d="M10 12h3" />
    </>
  );
}

function GridBoardIcon({ color }: IconProps) {
  return (
    <path
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3 3h18v18H3V3zM3 9h18M3 15h18M9 3v18M15 3v18M6 6h0M18 12h0M12 18h0"
    />
  );
}

function BloodDropIcon({ color }: IconProps) {
  return (
    <path
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 2C12 2 6 10 6 14.5a6 6 0 0012 0C18 10 12 2 12 2z"
    />
  );
}

function ChainReactionIcon({ color }: IconProps) {
  return (
    <>
      {/* Chain link 1 (top) — rounded rectangle rotated */}
      <rect
        x="6"
        y="1"
        width="6"
        height="10"
        rx="3"
        stroke={color}
        fill="none"
        transform="rotate(15 9 6)"
      />
      {/* Chain link 2 (middle) — interlocked */}
      <rect
        x="9.5"
        y="7"
        width="6"
        height="10"
        rx="3"
        stroke={color}
        fill="none"
        transform="rotate(-10 12.5 12)"
      />
      {/* Chain link 3 (bottom) — interlocked */}
      <rect
        x="7"
        y="13"
        width="6"
        height="10"
        rx="3"
        stroke={color}
        fill="none"
        transform="rotate(15 10 18)"
      />
    </>
  );
}

function OneJumpWonderIcon({ color }: IconProps) {
  return (
    <>
      {/* Rounded square burst — spikes on each side and corner */}
      <path
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 1l1 4 3.5-2.5-1 4 4-1L17 9l4 3-4 3 2.5 3.5-4-1 1 4L13 19l-1 4-1-4-3.5 2.5 1-4-4 1L7 15l-4-3 4-3-2.5-3.5 4 1-1-4L11 5l1-4z"
      />
      {/* Number 1 — centered with breathing room */}
      <path stroke={color} strokeLinecap="round" strokeWidth={2.2} d="M10.5 10l2-1.5v7" />
    </>
  );
}

// Trophy fallback for unknown IDs
function TrophyFallbackIcon({ color }: IconProps) {
  return (
    <path
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M6 9V2h12v7a6 6 0 01-12 0zM6 4H4a1 1 0 00-1 1v1a4 4 0 004 4M18 4h2a1 1 0 011 1v1a4 4 0 01-4 4M9 21h6M12 15v6"
    />
  );
}

// ---------------------------------------------------------------------------
// Icon registry
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, (props: IconProps) => React.JSX.Element> = {
  "first-move": FootstepIcon,
  "getting-started": BarChartIcon,
  regular: CoffeeIcon,
  centurion: HelmetIcon,
  veteran: MedalStarIcon,
  "first-fall": FallingIcon,
  "tough-luck": TombstoneIcon,
  "punching-bag": BoxingGloveIcon,
  "ai-easy": BabyBottleIcon,
  "ai-medium": RobotIcon,
  "ai-hard": SkullIcon,
  "speed-demon": FlameIcon,
  "buzzer-beater": BellIcon,
  "one-second-glory": HourglassIcon,
  "first-friend": TwoPeopleIcon,
  "social-butterfly": ButterflyIcon,
  "top-one-percent": CrownIcon,
  "tournament-champion": VikingHelmetIcon,
  "tutorial-complete": GradCapIcon,
  spectator: BinocularsIcon,
  "rage-quit": DoorExitIcon,
  "night-owl": MoonIcon,
  speedrun: RocketIcon,
  "comeback-kid": RisingArrowIcon,
  "flawless-victory": DiamondIcon,
  "david-vs-goliath": DavidGoliathIcon,
  "checkered-past": GridBoardIcon,
  "first-blood": BloodDropIcon,
  "chain-reaction": ChainReactionIcon,
  "one-jump-wonder": OneJumpWonderIcon,
};

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export function AchievementIcon({
  id,
  tier,
  unlocked = true,
  className = "h-6 w-6",
}: {
  id: string;
  tier: AchievementTier;
  unlocked?: boolean;
  className?: string;
}) {
  const color = unlocked ? TIER_COLORS[tier] : MUTED;
  const IconComponent = ICON_MAP[id] ?? TrophyFallbackIcon;

  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" strokeWidth={1.8}>
      <IconComponent color={color} />
    </svg>
  );
}
