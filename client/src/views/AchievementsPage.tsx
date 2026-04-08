"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Navbar } from "@/components/Navbar";
import { useAuth } from "@/lib/AuthContext";
import { useLobbyMessage } from "@/lib/LobbySocketContext";
import { CardContent } from "@/components/ui/card";
import { PaperCard } from "@/components/ui/paper-card";
import { AnimatedCard } from "@/components/ui/animated-card";
import { Button } from "@/components/ui/button";
import { SkeletonCard } from "@/components/ui/skeleton";
import { AchievementIcon } from "@/components/AchievementIcon";
import { getMyAchievements, type PlayerAchievement } from "@/lib/api";
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_CATEGORIES,
  type AchievementDefinition,
  type AchievementTier,
  type AchievementCategory,
} from "@shared";

// ---------------------------------------------------------------------------
// Tier styling
// ---------------------------------------------------------------------------

const TIER_STYLES: Record<
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

const TIER_LABELS: Record<AchievementTier, string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
};

const CATEGORY_ICONS: Record<AchievementCategory, string> = {
  games: "\u265f\ufe0e", // chess pawn
  combat: "\u2694\ufe0e", // crossed swords
  speed: "\u26a1", // lightning
  social: "\ud83e\udd1d", // handshake
  ranking: "\ud83c\udfc6", // trophy
  tournament: "\ud83c\udfc5", // medal
  learning: "\ud83c\udf93", // graduation cap
  secret: "\u2753", // question mark
};

// ---------------------------------------------------------------------------
// AchievementCard
// ---------------------------------------------------------------------------

function AchievementCard({
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
      className={`relative overflow-hidden rounded-xl border bg-gradient-to-br p-4 transition-all duration-300 ${
        unlocked
          ? `${tier.bg} ${tier.border} ${tier.glow}`
          : "border-[#d5c4a8]/40 from-[#e8dcc8]/30 to-[#ddd0b8]/10 opacity-50 grayscale"
      }`}
    >
      {/* Tier ribbon */}
      {unlocked && (
        <div
          className={`absolute right-0 top-0 rounded-bl-lg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
            def.tier === "platinum"
              ? "bg-cyan-500/20 text-cyan-700"
              : def.tier === "gold"
                ? "bg-yellow-500/20 text-yellow-700"
                : def.tier === "silver"
                  ? "bg-slate-400/20 text-slate-600"
                  : "bg-amber-700/20 text-amber-800"
          }`}
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

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function AchievementsPage() {
  const t = useTranslations("achievements");
  const tCommon = useTranslations("common");
  const { auth, onOpenAuth, onLogout } = useAuth();
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);
  const [achievements, setAchievements] = useState<PlayerAchievement[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAchievements = useCallback(
    (silent = false) => {
      if (!auth || auth.player.kind !== "account") {
        setLoading(false);
        return;
      }
      if (!silent) setLoading(true);
      void getMyAchievements().then((data) => {
        setAchievements(data.achievements);
        setLoading(false);
      });
    },
    [auth],
  );

  useEffect(() => {
    fetchAchievements();
  }, [fetchAchievements]);

  // Refresh when achievements change via WebSocket (silent — no skeleton)
  useLobbyMessage((payload) => {
    if (payload.type === "achievement-unlocked" || payload.type === "achievement-changed") {
      fetchAchievements(true);
    }
  });

  const unlockedMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of achievements) m.set(a.achievementId, a.unlockedAt);
    return m;
  }, [achievements]);

  const unlockedCount = achievements.length;
  const totalCount = ACHIEVEMENTS.length;

  // Group achievements by category
  const grouped = useMemo(() => {
    const map = new Map<AchievementCategory, AchievementDefinition[]>();
    for (const cat of ACHIEVEMENT_CATEGORIES) {
      map.set(cat.key, []);
    }
    for (const a of ACHIEVEMENTS) {
      const list = map.get(a.category);
      if (list) list.push(a);
    }
    return map;
  }, []);

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 bg-[radial-gradient(circle_at_top,rgba(255,247,231,0.76),transparent_58%)]" />

      <Navbar
        mode="lobby"
        auth={auth}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen((v) => !v)}
        onCloseNav={() => setNavOpen(false)}
        onOpenAuth={onOpenAuth}
        onLogout={onLogout}
      />

      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 pb-12 pt-20 sm:px-6 lg:pt-24">
        <Button variant="ghost" className="self-start text-[#8b7356]" onClick={() => router.back()}>
          &larr; {tCommon("back")}
        </Button>

        {/* Header */}
        <AnimatedCard delay={0}>
          <PaperCard className="w-full">
            <CardContent className="flex flex-col items-center gap-3 py-8">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-yellow-400/30 to-amber-600/20 shadow-[0_0_24px_rgba(234,179,8,0.2)]">
                <svg
                  className="h-8 w-8 text-yellow-600"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 9V2h12v7a6 6 0 01-12 0zM6 4H4a1 1 0 00-1 1v1a4 4 0 004 4M18 4h2a1 1 0 011 1v1a4 4 0 01-4 4M9 21h6M12 15v6"
                  />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-[#2b1e14]">{t("title")}</h1>
              <p className="text-sm text-[#8d7760]">
                {t("progress", { count: unlockedCount, total: totalCount })}
              </p>
              {/* Progress bar */}
              <div className="mt-1 h-2.5 w-full max-w-xs overflow-hidden rounded-full bg-[#d5c4a8]/40">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-yellow-500 to-amber-500 transition-all duration-700"
                  style={{
                    width: `${totalCount > 0 ? (unlockedCount / totalCount) * 100 : 0}%`,
                  }}
                />
              </div>
            </CardContent>
          </PaperCard>
        </AnimatedCard>

        {loading && (
          <>
            <SkeletonCard rows={3} />
            <SkeletonCard rows={3} />
          </>
        )}

        {!loading && !auth?.player.kind && (
          <PaperCard className="w-full">
            <CardContent className="flex flex-col items-center gap-4 py-12">
              <p className="text-sm text-[#8d7760]">{t("signInRequired")}</p>
              <Button onClick={() => onOpenAuth("login")}>{tCommon("signIn")}</Button>
            </CardContent>
          </PaperCard>
        )}

        {!loading &&
          auth?.player.kind === "account" &&
          ACHIEVEMENT_CATEGORIES.map(({ key }, catIndex) => {
            const defs = grouped.get(key);
            if (!defs || defs.length === 0) return null;

            const catUnlocked = defs.filter((d) => unlockedMap.has(d.id)).length;

            // For secret category, only show if player has unlocked at least one OR show placeholder
            const hasUnlocked = catUnlocked > 0;
            if (key === "secret" && !hasUnlocked) {
              return (
                <AnimatedCard key={key} delay={catIndex * 0.05}>
                  <div className="mb-6">
                    <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-[#2b1e14]">
                      <span>{CATEGORY_ICONS[key]}</span> {t(`category_${key}`)}
                      <span className="ml-auto text-sm font-normal text-[#a89a7e]">
                        ?/{defs.length}
                      </span>
                    </h2>
                    <PaperCard>
                      <CardContent className="py-8 text-center">
                        <p className="text-sm text-[#a89a7e]">{t("secretHint")}</p>
                      </CardContent>
                    </PaperCard>
                  </div>
                </AnimatedCard>
              );
            }

            return (
              <AnimatedCard key={key} delay={catIndex * 0.05}>
                <div className="mb-6">
                  <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-[#2b1e14]">
                    <span>{CATEGORY_ICONS[key]}</span> {t(`category_${key}`)}
                    <span className="ml-auto text-sm font-normal text-[#a89a7e]">
                      {catUnlocked}/{defs.length}
                    </span>
                  </h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {defs
                      .sort((a, b) => a.order - b.order)
                      .map((def) => (
                        <AchievementCard
                          key={def.id}
                          def={def}
                          unlocked={unlockedMap.has(def.id)}
                          unlockedAt={unlockedMap.get(def.id)}
                        />
                      ))}
                  </div>
                </div>
              </AnimatedCard>
            );
          })}
      </main>
    </div>
  );
}
