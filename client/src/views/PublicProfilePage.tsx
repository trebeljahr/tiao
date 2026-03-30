"use client";
import { useState, useEffect, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { useAuth } from "@/lib/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getPublicProfile, getPlayerMatchHistory, type PublicProfile } from "@/lib/api";
import type { MultiplayerGameSummary } from "@shared";
import { PlayerOverviewAvatar } from "@/components/game/GameShared";
import { MatchHistoryCard } from "@/components/game/MatchHistoryCard";
import { UserBadge, type BadgeId, BADGE_DEFINITIONS } from "@/components/UserBadge";
import { resolvePlayerBadges } from "@/lib/featureGate";
import { useLocale, useTranslations } from "next-intl";
import { useSocialData } from "@/lib/hooks/useSocialData";
import { useLobbyMessage } from "@/lib/LobbySocketContext";

export function PublicProfilePage() {
  const t = useTranslations("publicProfile");
  const tCommon = useTranslations("common");
  const tConfig = useTranslations("config");
  const { auth, onOpenAuth, onLogout } = useAuth();
  const router = useRouter();
  const params = useParams<{ username: string }>();
  const [navOpen, setNavOpen] = useState(false);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [matchHistory, setMatchHistory] = useState<MultiplayerGameSummary[]>([]);
  const [matchPlayerId, setMatchPlayerId] = useState<string | null>(null);
  const [matchHasMore, setMatchHasMore] = useState(false);
  const [matchLoading, setMatchLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const locale = useLocale();

  const social = useSocialData(auth, false);

  // Auto-refresh social data when a social-update arrives via WebSocket
  useLobbyMessage((payload) => {
    if (payload.type === "social-update") {
      void social.refreshSocialOverview({ silent: true });
    }
  });

  // Derive friend relationship
  const profileId = profile?.playerId;
  const isOwnProfile = auth?.player.playerId === profileId;
  const isAccount = auth?.player.kind === "account";

  const friendRelationship = useMemo(() => {
    if (!profileId || isOwnProfile || !isAccount) return "none" as const;
    if (social.socialOverview.friends.some((f) => f.playerId === profileId))
      return "friend" as const;
    if (social.socialOverview.outgoingFriendRequests.some((f) => f.playerId === profileId))
      return "outgoing" as const;
    if (social.socialOverview.incomingFriendRequests.some((f) => f.playerId === profileId))
      return "incoming" as const;
    return "none" as const;
  }, [profileId, isOwnProfile, isAccount, social.socialOverview]);

  useEffect(() => {
    if (!params?.username) return;
    setLoading(true);
    setError(null);
    const decoded = decodeURIComponent(params.username);
    getPublicProfile(decoded)
      .then((res) => {
        setProfile(res.profile);
      })
      .catch(() => setError("not-found"))
      .finally(() => setLoading(false));
    getPlayerMatchHistory(decoded)
      .then((res) => {
        setMatchHistory(res.games);
        setMatchPlayerId(res.playerId);
        setMatchHasMore(res.hasMore);
      })
      .catch(() => {});
  }, [params?.username]);

  const handleLoadMore = async () => {
    if (!params?.username || matchLoading || !matchHasMore) return;
    setMatchLoading(true);
    const lastGame = matchHistory[matchHistory.length - 1];
    try {
      const res = await getPlayerMatchHistory(decodeURIComponent(params.username), {
        before: lastGame.updatedAt,
      });
      setMatchHistory((prev) => [...prev, ...res.games]);
      setMatchHasMore(res.hasMore);
    } catch {
      /* silent */
    } finally {
      setMatchLoading(false);
    }
  };

  const handleCopy = (gameId: string) => {
    void navigator.clipboard.writeText(gameId);
    setCopiedId(gameId);
    setTimeout(() => setCopiedId((prev) => (prev === gameId ? null : prev)), 1800);
  };

  const paperCard =
    "border-[#d0bb94]/75 bg-[linear-gradient(180deg,rgba(255,250,242,0.96),rgba(244,231,207,0.94))]";

  const activeBadges = resolvePlayerBadges(profile);
  const allBadges = (profile?.badges ?? []).filter((id) => BADGE_DEFINITIONS[id as BadgeId]);

  const memberDays = profile?.createdAt
    ? Math.floor((Date.now() - new Date(profile.createdAt).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[18rem] bg-[radial-gradient(circle_at_top,_rgba(255,247,231,0.76),_transparent_58%)]" />

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
        <Button variant="ghost" className="self-start text-[#8b7356]" onClick={() => router.back()}>
          &larr; {tCommon("back")}
        </Button>

        {loading && (
          <Card className={paperCard + " w-full"}>
            <CardContent className="flex items-center justify-center py-16">
              <p className="text-sm text-[#8d7760]">{t("loadingProfile")}</p>
            </CardContent>
          </Card>
        )}

        {error && (
          <Card className={paperCard + " w-full"}>
            <CardContent className="flex flex-col items-center gap-4 py-16">
              <p className="text-sm text-[#8d7760]">{t("playerNotFound")}</p>
              <Button variant="secondary" onClick={() => router.push("/")}>
                {tCommon("backToLobby")}
              </Button>
            </CardContent>
          </Card>
        )}

        {profile && (
          <>
            {/* Header card with avatar, name, badge, rating */}
            <Card className={paperCard + " w-full"}>
              <CardContent className="flex flex-col items-center gap-6 pt-8 pb-8">
                <PlayerOverviewAvatar
                  player={profile}
                  className="h-24 w-24 border-4 border-[#e8d9c0] shadow-[0_20px_40px_-20px_rgba(63,37,17,0.4)]"
                />

                <div className="text-center">
                  {isOwnProfile && (
                    <span className="mb-2 inline-flex items-center rounded-full border border-[#dcc7a3] bg-[#fff9ef] px-3 py-1 text-xs font-semibold text-[#6b5630]">
                      {t("yourProfile")}
                    </span>
                  )}
                  <div className="flex items-center justify-center gap-2">
                    <h1 className="font-display text-3xl font-bold text-[#2b1e14]">
                      {profile.displayName}
                    </h1>
                    {activeBadges.map((id) => (
                      <UserBadge key={id} badge={id as BadgeId} />
                    ))}
                  </div>

                  {/* Friend action buttons */}
                  {isAccount && !isOwnProfile && profileId && (
                    <div className="mt-3 flex items-center justify-center gap-2">
                      {friendRelationship === "none" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs"
                          onClick={() => social.handleSendFriendRequest(profileId)}
                          disabled={social.socialActionBusyKey === `friend-send:${profileId}`}
                        >
                          {tCommon("addFriend")}
                        </Button>
                      )}
                      {friendRelationship === "outgoing" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs text-[#8d7760]"
                          onClick={() => social.handleCancelFriendRequest(profileId)}
                          disabled={social.socialActionBusyKey === `friend-cancel:${profileId}`}
                        >
                          {tCommon("pending")} &times;
                        </Button>
                      )}
                      {friendRelationship === "incoming" && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                            onClick={() => social.handleAcceptFriendRequest(profileId)}
                            disabled={social.socialActionBusyKey === `friend-accept:${profileId}`}
                          >
                            {tCommon("accept")}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs text-[#8d7760]"
                            onClick={() => social.handleDeclineFriendRequest(profileId)}
                            disabled={social.socialActionBusyKey === `friend-decline:${profileId}`}
                          >
                            {tCommon("decline")}
                          </Button>
                        </>
                      )}
                      {friendRelationship === "friend" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs text-red-600 hover:bg-red-50 hover:border-red-300"
                          onClick={() => social.handleRemoveFriend(profileId)}
                          disabled={social.socialActionBusyKey === `friend-remove:${profileId}`}
                        >
                          {tCommon("unfriend")}
                        </Button>
                      )}
                    </div>
                  )}

                  {profile.bio && (
                    <p className="mt-3 max-w-md text-sm text-[#6e5b48]">{profile.bio}</p>
                  )}

                  <div className="mt-4 inline-flex items-baseline gap-2 rounded-xl border border-[#dcc7a3] bg-[#fff9ef] px-4 py-2">
                    <span className="text-sm font-medium text-[#4e3d2c]">{t("rating")}</span>
                    <span className="font-display text-lg font-bold text-[#2b1e14]">
                      {profile.rating ?? 1500}
                    </span>
                    {(profile.gamesPlayed ?? 0) > 0 && profile.ratingPercentile != null && (
                      <span className="text-xs text-[#8d7760]">
                        {t("ratingPercentile", { percentile: 100 - profile.ratingPercentile })}
                      </span>
                    )}
                    {(profile.gamesPlayed ?? 0) === 0 && (
                      <span className="text-xs text-[#8d7760]">{t("ratingProvisional")}</span>
                    )}
                  </div>

                  {profile.createdAt && (
                    <p className="mt-2 text-sm text-[#8d7760]">
                      {t("memberSince", {
                        date: new Date(profile.createdAt).toLocaleDateString(locale, {
                          month: "long",
                          year: "numeric",
                        }),
                        days: memberDays ?? 0,
                      })}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Stats card */}
            {(profile.gamesPlayed ?? 0) > 0 && (
              <Card className={paperCard + " w-full"}>
                <CardContent className="py-6">
                  <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[#8d7760]">
                    {t("stats")}
                  </h2>
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <p className="font-display text-2xl font-bold text-[#2b1e14]">
                        {profile.gamesPlayed ?? 0}
                      </p>
                      <p className="text-xs text-[#8d7760]">{t("gamesPlayed")}</p>
                    </div>
                    <div>
                      <p className="font-display text-2xl font-bold text-emerald-700">
                        {profile.gamesWon ?? 0}
                      </p>
                      <p className="text-xs text-[#8d7760]">{t("gamesWon")}</p>
                    </div>
                    <div>
                      <p className="font-display text-2xl font-bold text-red-700">
                        {profile.gamesLost ?? 0}
                      </p>
                      <p className="text-xs text-[#8d7760]">{t("gamesLost")}</p>
                    </div>
                  </div>

                  {(profile.favoriteBoard ||
                    profile.favoriteTimeControl ||
                    profile.favoriteScore) && (
                    <div className="mt-5 flex flex-wrap justify-center gap-3">
                      <h3 className="w-full text-center text-xs font-semibold uppercase tracking-wider text-[#8d7760]">
                        {t("favoriteGameTypes")}
                      </h3>
                      {profile.favoriteBoard && (
                        <span className="rounded-lg border border-[#dcc7a3] bg-[#fff9ef] px-3 py-1.5 text-xs text-[#4e3d2c]">
                          {t("favoriteBoard", { size: profile.favoriteBoard })}
                        </span>
                      )}
                      {profile.favoriteTimeControl && (
                        <span className="rounded-lg border border-[#dcc7a3] bg-[#fff9ef] px-3 py-1.5 text-xs text-[#4e3d2c]">
                          {t("favoriteTimeControl", {
                            tc:
                              profile.favoriteTimeControl === "unlimited"
                                ? tConfig("unlimited")
                                : profile.favoriteTimeControl,
                          })}
                        </span>
                      )}
                      {profile.favoriteScore && (
                        <span className="rounded-lg border border-[#dcc7a3] bg-[#fff9ef] px-3 py-1.5 text-xs text-[#4e3d2c]">
                          {t("favoriteScore", { score: profile.favoriteScore })}
                        </span>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Badges card */}
            {allBadges.length > 0 && (
              <Card className={paperCard + " w-full"}>
                <CardContent className="py-6">
                  <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[#8d7760]">
                    {t("badges")}
                  </h2>
                  <div className="flex flex-wrap justify-center gap-3">
                    {allBadges.map((id) => (
                      <UserBadge key={id} badge={id as BadgeId} />
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Match history */}
            {matchHistory.length > 0 && (matchPlayerId || auth?.player.playerId) && (
              <Card className={paperCard + " w-full"}>
                <CardContent className="py-6">
                  <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[#8d7760]">
                    {t("matchHistory")}
                  </h2>
                  <div className="grid gap-3">
                    {matchHistory.map((game) => (
                      <MatchHistoryCard
                        key={game.gameId}
                        game={game}
                        playerId={auth?.player.playerId ?? matchPlayerId!}
                        copiedId={copiedId}
                        onCopy={() => handleCopy(game.gameId)}
                        onReview={() => router.push(`/game/${game.gameId}`)}
                      />
                    ))}
                  </div>
                  {matchHasMore && (
                    <div className="mt-4 flex justify-center">
                      <Button
                        variant="ghost"
                        className="text-[#8b7356]"
                        onClick={handleLoadMore}
                        disabled={matchLoading}
                      >
                        {matchLoading ? "..." : t("loadMore")}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  );
}
