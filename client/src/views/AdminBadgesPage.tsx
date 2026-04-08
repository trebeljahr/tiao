"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useAuth } from "@/lib/AuthContext";
import { BackButton } from "@/components/BackButton";
import { PageLayout } from "@/components/PageLayout";
import { Button } from "@/components/ui/button";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PaperCard } from "@/components/ui/paper-card";
import { AnimatedCard } from "@/components/ui/animated-card";
import { Input } from "@/components/ui/input";
import { isAdmin } from "@/lib/featureGate";
import { UserBadge, type BadgeId, BADGE_DEFINITIONS, ALL_BADGE_IDS } from "@/components/UserBadge";
import { BadgeToast } from "@/components/BadgeToast";
import { PlayerIdentityRow } from "@/components/PlayerIdentityRow";
import {
  adminSearchUsers,
  adminGrantBadge,
  adminRevokeBadge,
  adminGrantTheme,
  adminRevokeTheme,
  adminGrantAchievement,
  adminRevokeAchievement,
  type AdminUserResult,
} from "@/lib/api";
import { THEMES } from "@/components/game/boardThemes";
import { toastError } from "@/lib/errors";
import { ACHIEVEMENTS, ACHIEVEMENT_CATEGORIES, type AchievementDefinition } from "@shared";
import { AchievementIcon } from "@/components/AchievementIcon";
import { useAchievementName, useAchievementDescription } from "@/lib/achievementLabels";

export function AdminBadgesPage() {
  const t = useTranslations("adminBadges");
  const tCommon = useTranslations("common");
  const { auth } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AdminUserResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AdminUserResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const { users } = await adminSearchUsers(searchQuery.trim());
      setSearchResults(users);
    } catch (error) {
      toastError(error);
    } finally {
      setSearching(false);
    }
  }, [searchQuery]);

  const handleGrant = useCallback(
    async (badgeId: string) => {
      if (!selectedUser) return;
      setBusy(badgeId);
      try {
        const result = await adminGrantBadge(selectedUser.playerId, badgeId);
        setSelectedUser((prev) =>
          prev ? { ...prev, badges: result.badges, activeBadges: result.activeBadges } : null,
        );
        // Also update in search results
        setSearchResults((prev) =>
          prev.map((u) =>
            u.playerId === selectedUser.playerId
              ? { ...u, badges: result.badges, activeBadges: result.activeBadges }
              : u,
          ),
        );
        toast.success(<BadgeToast badge={badgeId as BadgeId} title={t("badgeGrantedShort")} />);
      } catch (error) {
        toastError(error);
      } finally {
        setBusy(null);
      }
    },
    [selectedUser, t],
  );

  const handleRevoke = useCallback(
    async (badgeId: string) => {
      if (!selectedUser) return;
      setBusy(badgeId);
      try {
        const result = await adminRevokeBadge(selectedUser.playerId, badgeId);
        setSelectedUser((prev) =>
          prev ? { ...prev, badges: result.badges, activeBadges: result.activeBadges } : null,
        );
        setSearchResults((prev) =>
          prev.map((u) =>
            u.playerId === selectedUser.playerId
              ? { ...u, badges: result.badges, activeBadges: result.activeBadges }
              : u,
          ),
        );
        toast.success(<BadgeToast badge={badgeId as BadgeId} title={t("badgeRevokedShort")} />);
      } catch (error) {
        toastError(error);
      } finally {
        setBusy(null);
      }
    },
    [selectedUser, t],
  );

  const handleGrantTheme = useCallback(
    async (themeId: string) => {
      if (!selectedUser) return;
      setBusy(themeId);
      try {
        const result = await adminGrantTheme(selectedUser.playerId, themeId);
        setSelectedUser((prev) =>
          prev ? { ...prev, unlockedThemes: result.unlockedThemes } : null,
        );
        setSearchResults((prev) =>
          prev.map((u) =>
            u.playerId === selectedUser.playerId
              ? { ...u, unlockedThemes: result.unlockedThemes }
              : u,
          ),
        );
        toast.success(t("themeGranted", { theme: themeId }));
      } catch (error) {
        toastError(error);
      } finally {
        setBusy(null);
      }
    },
    [selectedUser, t],
  );

  const handleRevokeTheme = useCallback(
    async (themeId: string) => {
      if (!selectedUser) return;
      setBusy(themeId);
      try {
        const result = await adminRevokeTheme(selectedUser.playerId, themeId);
        setSelectedUser((prev) =>
          prev ? { ...prev, unlockedThemes: result.unlockedThemes } : null,
        );
        setSearchResults((prev) =>
          prev.map((u) =>
            u.playerId === selectedUser.playerId
              ? { ...u, unlockedThemes: result.unlockedThemes }
              : u,
          ),
        );
        toast.success(t("themeRevoked", { theme: themeId }));
      } catch (error) {
        toastError(error);
      } finally {
        setBusy(null);
      }
    },
    [selectedUser, t],
  );

  const handleGrantAchievement = useCallback(
    async (achievementId: string) => {
      if (!selectedUser) return;
      setBusy(`ach-${achievementId}`);
      try {
        const result = await adminGrantAchievement(selectedUser.playerId, achievementId);
        setSelectedUser((prev) => (prev ? { ...prev, achievements: result.achievements } : null));
        setSearchResults((prev) =>
          prev.map((u) =>
            u.playerId === selectedUser.playerId ? { ...u, achievements: result.achievements } : u,
          ),
        );
        toast.success(t("achievementGranted", { achievement: achievementId }));
      } catch (error) {
        toastError(error);
      } finally {
        setBusy(null);
      }
    },
    [selectedUser, t],
  );

  const handleRevokeAchievement = useCallback(
    async (achievementId: string) => {
      if (!selectedUser) return;
      setBusy(`ach-${achievementId}`);
      try {
        const result = await adminRevokeAchievement(selectedUser.playerId, achievementId);
        setSelectedUser((prev) => (prev ? { ...prev, achievements: result.achievements } : null));
        setSearchResults((prev) =>
          prev.map((u) =>
            u.playerId === selectedUser.playerId ? { ...u, achievements: result.achievements } : u,
          ),
        );
        toast.success(t("achievementRevoked", { achievement: achievementId }));
      } catch (error) {
        toastError(error);
      } finally {
        setBusy(null);
      }
    },
    [selectedUser, t],
  );

  // Not admin — show forbidden
  if (!isAdmin(auth)) {
    return (
      <PageLayout
        maxWidth="max-w-2xl"
        mainClassName="items-center gap-6 pb-12 lg:px-6 lg:pb-12 lg:pt-24"
      >
        <PaperCard className="w-full">
          <CardContent className="py-12 text-center">
            <p className="text-lg font-semibold text-[#5c4a32]">{t("forbidden")}</p>
          </CardContent>
        </PaperCard>
      </PageLayout>
    );
  }

  return (
    <PageLayout maxWidth="max-w-2xl" mainClassName="gap-6 pb-12 lg:px-6 lg:pb-12 lg:pt-24">
      <BackButton />

      <h1 className="text-2xl font-bold text-[#5c4a32]">{t("title")}</h1>

      {/* Search */}
      <AnimatedCard delay={0}>
        <PaperCard>
          <CardHeader>
            <CardTitle className="text-[#5c4a32]">{t("searchUsers")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("searchPlaceholder")}
                className="border-[#d0bb94] bg-white/60"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSearch();
                }}
              />
              <Button
                onClick={handleSearch}
                disabled={searching || !searchQuery.trim()}
                className="bg-[#8b7356] text-white hover:bg-[#6d5a42]"
              >
                {searching ? tCommon("loading") : tCommon("search")}
              </Button>
            </div>

            {/* Search results */}
            {searchResults.length > 0 && (
              <div className="mt-4 space-y-2">
                {searchResults.map((user) => (
                  <button
                    key={user.playerId}
                    onClick={() => setSelectedUser(user)}
                    className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors ${
                      selectedUser?.playerId === user.playerId
                        ? "border-[#8b7356] bg-[#f5edd8]"
                        : "border-[#d0bb94]/50 bg-white/40 hover:bg-[#f5edd8]/50"
                    }`}
                  >
                    <PlayerIdentityRow
                      player={user}
                      linkToProfile={false}
                      friendVariant="light"
                      nameClassName="font-medium text-[#5c4a32]"
                    />
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </PaperCard>
      </AnimatedCard>

      {/* Badge management for selected user */}
      {selectedUser && (
        <AnimatedCard delay={0.05}>
          <PaperCard>
            <CardHeader>
              <CardTitle className="text-[#5c4a32]">
                {t("manageBadgesFor", { name: selectedUser.displayName })}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Current badges */}
              {selectedUser.badges.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-medium text-[#8b7356]">{t("currentBadges")}</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedUser.badges.map((badge) => (
                      <span key={badge} className="flex items-center gap-1">
                        <UserBadge badge={badge as BadgeId} />
                        {selectedUser.activeBadges.includes(badge) && (
                          <span className="text-xs text-[#8b7356]">({t("active")})</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* All badge types */}
              <div>
                <p className="mb-2 text-sm font-medium text-[#8b7356]">{t("allBadges")}</p>
                <div className="space-y-2">
                  {ALL_BADGE_IDS.map((badgeId) => {
                    const def = BADGE_DEFINITIONS[badgeId];
                    const hasIt = selectedUser.badges.includes(badgeId);

                    return (
                      <div
                        key={badgeId}
                        className="flex items-center justify-between rounded-lg border border-[#d0bb94]/50 bg-white/40 px-4 py-2"
                      >
                        <div className="flex items-center gap-3">
                          <UserBadge badge={badgeId} />
                          <span className="text-sm text-[#5c4a32]">
                            {badgeId}
                            <span className="ml-2 text-xs text-[#8b7356]">(T{def.tier})</span>
                          </span>
                        </div>
                        <Button
                          size="sm"
                          variant={hasIt ? "danger" : "default"}
                          disabled={busy === badgeId}
                          onClick={() => (hasIt ? handleRevoke(badgeId) : handleGrant(badgeId))}
                          className={hasIt ? "" : "bg-[#8b7356] text-white hover:bg-[#6d5a42]"}
                        >
                          {busy === badgeId ? tCommon("loading") : hasIt ? t("revoke") : t("grant")}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </PaperCard>
        </AnimatedCard>
      )}

      {/* Board theme management for selected user */}
      {selectedUser && (
        <AnimatedCard delay={0.1}>
          <PaperCard>
            <CardHeader>
              <CardTitle className="text-[#5c4a32]">{t("boardThemes")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Current unlocked themes */}
              {selectedUser.unlockedThemes.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-medium text-[#8b7356]">{t("currentBadges")}</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedUser.unlockedThemes.map((themeId) => (
                      <span
                        key={themeId}
                        className="rounded-md border border-[#d0bb94]/50 bg-white/60 px-2 py-1 text-xs text-[#5c4a32]"
                      >
                        {themeId}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* All theme types */}
              <div>
                <p className="mb-2 text-sm font-medium text-[#8b7356]">{t("allBadges")}</p>
                <div className="space-y-2">
                  {THEMES.map((theme) => {
                    const hasIt = selectedUser.unlockedThemes.includes(theme.id);

                    return (
                      <div
                        key={theme.id}
                        className="flex items-center justify-between rounded-lg border border-[#d0bb94]/50 bg-white/40 px-4 py-2"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-sm text-[#5c4a32]">
                            {theme.name}
                            <span className="ml-2 text-xs text-[#8b7356]">
                              ({theme.description})
                            </span>
                          </span>
                        </div>
                        <Button
                          size="sm"
                          variant={hasIt ? "danger" : "default"}
                          disabled={busy === theme.id}
                          onClick={() =>
                            hasIt ? handleRevokeTheme(theme.id) : handleGrantTheme(theme.id)
                          }
                          className={hasIt ? "" : "bg-[#8b7356] text-white hover:bg-[#6d5a42]"}
                        >
                          {busy === theme.id
                            ? tCommon("loading")
                            : hasIt
                              ? t("revokeTheme")
                              : t("grantTheme")}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </PaperCard>
        </AnimatedCard>
      )}

      {/* Achievement management for selected user */}
      {selectedUser && (
        <AnimatedCard delay={0.15}>
          <PaperCard>
            <CardHeader>
              <CardTitle className="text-[#5c4a32]">{t("achievements")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Current achievements count */}
              <p className="text-sm text-[#8b7356]">
                {t("achievementCount", { count: selectedUser.achievements?.length ?? 0 })}
              </p>

              {/* All achievements grouped by category */}
              {ACHIEVEMENT_CATEGORIES.map(({ key, label }) => {
                const defs = ACHIEVEMENTS.filter((a) => a.category === key);
                if (defs.length === 0) return null;

                return (
                  <div key={key}>
                    <p className="mb-2 text-sm font-medium text-[#8b7356]">{label}</p>
                    <div className="space-y-2">
                      {defs
                        .sort((a, b) => a.order - b.order)
                        .map((def) => {
                          const hasIt = selectedUser.achievements?.includes(def.id) ?? false;
                          const busyKey = `ach-${def.id}`;

                          return (
                            <AchievementAdminRow
                              key={def.id}
                              def={def}
                              hasIt={hasIt}
                              busy={busy === busyKey}
                              loadingLabel={tCommon("loading")}
                              grantLabel={t("grant")}
                              revokeLabel={t("revoke")}
                              onGrant={() => handleGrantAchievement(def.id)}
                              onRevoke={() => handleRevokeAchievement(def.id)}
                            />
                          );
                        })}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </PaperCard>
        </AnimatedCard>
      )}
    </PageLayout>
  );
}

function AchievementAdminRow({
  def,
  hasIt,
  busy,
  loadingLabel,
  grantLabel,
  revokeLabel,
  onGrant,
  onRevoke,
}: {
  def: AchievementDefinition;
  hasIt: boolean;
  busy: boolean;
  loadingLabel: string;
  grantLabel: string;
  revokeLabel: string;
  onGrant: () => void;
  onRevoke: () => void;
}) {
  const name = useAchievementName(def.id);
  const description = useAchievementDescription(def.id);

  return (
    <div className="flex items-center justify-between rounded-lg border border-[#d0bb94]/50 bg-white/40 px-4 py-2">
      <div className="flex items-center gap-3">
        <AchievementIcon id={def.id} tier={def.tier} unlocked={hasIt} className="h-5 w-5" />
        <div className="min-w-0">
          <span className="text-sm text-[#5c4a32]">
            {name}
            {def.secret && <span className="ml-1.5 text-xs text-[#a89a7e]">(secret)</span>}
          </span>
          <p className="truncate text-xs text-[#8b7356]">{description}</p>
        </div>
      </div>
      <Button
        size="sm"
        variant={hasIt ? "danger" : "default"}
        disabled={busy}
        onClick={() => (hasIt ? onRevoke() : onGrant())}
        className={hasIt ? "" : "bg-[#8b7356] text-white hover:bg-[#6d5a42]"}
      >
        {busy ? loadingLabel : hasIt ? revokeLabel : grantLabel}
      </Button>
    </div>
  );
}
