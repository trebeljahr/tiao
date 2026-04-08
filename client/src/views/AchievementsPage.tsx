"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/lib/AuthContext";
import { BackButton } from "@/components/BackButton";
import { PageLayout } from "@/components/PageLayout";
import { useLobbyMessage } from "@/lib/LobbySocketContext";
import { CardContent } from "@/components/ui/card";
import { PaperCard } from "@/components/ui/paper-card";
import { AnimatedCard } from "@/components/ui/animated-card";
import { Button } from "@/components/ui/button";
import { SkeletonCard } from "@/components/ui/skeleton";
import { AchievementCard } from "@/components/AchievementCard";
import { getMyAchievements, type PlayerAchievement } from "@/lib/api";
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_CATEGORIES,
  type AchievementDefinition,
  type AchievementCategory,
} from "@shared";

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
// Page
// ---------------------------------------------------------------------------

export function AchievementsPage() {
  const t = useTranslations("achievements");
  const tCommon = useTranslations("common");
  const { auth, onOpenAuth } = useAuth();
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

  // After achievements load, jump to a #achievement-X hash if the user
  // arrived via a deep link (e.g. clicking a locked badge in the shop).
  useEffect(() => {
    if (loading) return;
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    const timer = setTimeout(() => {
      const el = document.getElementById(hash);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-yellow-400");
      setTimeout(() => el.classList.remove("ring-2", "ring-yellow-400"), 1800);
    }, 100);
    return () => clearTimeout(timer);
  }, [loading]);

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
    <PageLayout maxWidth="max-w-3xl" mainClassName="gap-6 pb-12 lg:px-6 lg:pb-12 lg:pt-24">
      <BackButton />

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
    </PageLayout>
  );
}
