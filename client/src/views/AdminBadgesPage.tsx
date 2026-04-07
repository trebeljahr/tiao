"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Navbar } from "@/components/Navbar";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PaperCard } from "@/components/ui/paper-card";
import { Input } from "@/components/ui/input";
import { isAdmin } from "@/lib/featureGate";
import { UserBadge, type BadgeId, BADGE_DEFINITIONS, ALL_BADGE_IDS } from "@/components/UserBadge";
import { PlayerIdentityRow } from "@/components/PlayerIdentityRow";
import {
  adminSearchUsers,
  adminGrantBadge,
  adminRevokeBadge,
  adminGrantTheme,
  adminRevokeTheme,
  type AdminUserResult,
} from "@/lib/api";
import { THEMES } from "@/components/game/boardThemes";
import { toastError } from "@/lib/errors";

export function AdminBadgesPage() {
  const t = useTranslations("adminBadges");
  const tCommon = useTranslations("common");
  const { auth, onOpenAuth, onLogout } = useAuth();
  const router = useRouter();

  const [navOpen, setNavOpen] = useState(false);
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
        toast.success(t("badgeGranted", { badge: badgeId }));
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
        toast.success(t("badgeRevoked", { badge: badgeId }));
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

  // Not admin — show forbidden
  if (!isAdmin(auth)) {
    return (
      <div className="relative min-h-screen">
        <Navbar
          mode="lobby"
          auth={auth}
          navOpen={navOpen}
          onToggleNav={() => setNavOpen((v) => !v)}
          onCloseNav={() => setNavOpen(false)}
          onOpenAuth={onOpenAuth}
          onLogout={onLogout}
        />
        <main className="mx-auto flex max-w-2xl flex-col items-center gap-6 px-4 pb-12 pt-20 sm:px-6 lg:pt-24">
          <PaperCard className="w-full">
            <CardContent className="py-12 text-center">
              <p className="text-lg font-semibold text-[#5c4a32]">{t("forbidden")}</p>
            </CardContent>
          </PaperCard>
        </main>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen">
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

      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 pb-12 pt-20 sm:px-6 lg:pt-24">
        <Button variant="ghost" className="self-start text-[#8b7356]" onClick={() => router.back()}>
          &larr; {tCommon("back")}
        </Button>

        <h1 className="text-2xl font-bold text-[#5c4a32]">{t("title")}</h1>

        {/* Search */}
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

        {/* Badge management for selected user */}
        {selectedUser && (
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
        )}

        {/* Board theme management for selected user */}
        {selectedUser && (
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
        )}
      </main>
    </div>
  );
}
