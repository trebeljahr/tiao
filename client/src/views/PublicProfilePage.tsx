"use client";
import { useState, useEffect, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { BackButton } from "@/components/BackButton";
import { PageLayout } from "@/components/PageLayout";
import { CardContent } from "@/components/ui/card";
import { PaperCard } from "@/components/ui/paper-card";
import { AnimatedCard } from "@/components/ui/animated-card";
import { Button } from "@/components/ui/button";
import {
  getPublicProfile,
  getPlayerMatchHistory,
  getPlayerAchievements,
  type PublicProfile,
  type PlayerAchievement,
} from "@/lib/api";
import type { MultiplayerGameSummary } from "@shared";
import { ACHIEVEMENTS } from "@shared";
import { AchievementCard } from "@/components/AchievementCard";
import { MatchHistoryCard } from "@/components/game/MatchHistoryCard";
import { UserBadge, type BadgeId, BADGE_DEFINITIONS } from "@/components/UserBadge";
import { PlayerIdentityRow } from "@/components/PlayerIdentityRow";
import { useLocale, useTranslations } from "next-intl";
import { useSocialData } from "@/lib/hooks/useSocialData";
import { useLobbyMessage } from "@/lib/LobbySocketContext";
import { SkeletonProfileHeader, SkeletonProfileStats } from "@/components/ui/skeleton";

export function PublicProfilePage() {
  const t = useTranslations("publicProfile");
  const tCommon = useTranslations("common");
  const tConfig = useTranslations("config");
  const { auth } = useAuth();
  const router = useRouter();
  const params = useParams<{ username: string }>();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [matchHistory, setMatchHistory] = useState<MultiplayerGameSummary[]>([]);
  const [matchPlayerId, setMatchPlayerId] = useState<string | null>(null);
  const [matchHasMore, setMatchHasMore] = useState(false);
  const [matchLoading, setMatchLoading] = useState(false);
  const [playerAchievements, setPlayerAchievements] = useState<PlayerAchievement[]>([]);
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
    getPlayerAchievements(decoded)
      .then((res) => setPlayerAchievements(res.achievements))
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

  const allBadges = (profile?.badges ?? []).filter((id) => BADGE_DEFINITIONS[id as BadgeId]);

  const memberDays = profile?.createdAt
    ? Math.floor((Date.now() - new Date(profile.createdAt).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <PageLayout
      maxWidth="max-w-2xl"
      mainClassName="items-center gap-6 pb-12 lg:px-6 lg:pb-12 lg:pt-24"
    >
      <BackButton />

      {loading && (
        <>
          <SkeletonProfileHeader />
          <SkeletonProfileStats />
        </>
      )}

      {error && (
        <PaperCard className="w-full">
          <CardContent className="flex flex-col items-center gap-4 py-16">
            <p className="text-sm text-[#8d7760]">{t("playerNotFound")}</p>
            <Button variant="secondary" onClick={() => router.push("/")}>
              {tCommon("backToLobby")}
            </Button>
          </CardContent>
        </PaperCard>
      )}

      {profile && (
        <>
          {/* Header card with avatar, name, badge, rating */}
          <AnimatedCard className="w-full">
            <PaperCard className="w-full">
              <CardContent className="flex flex-col items-center gap-6 pt-8 pb-8">
                <div className="text-center">
                  {isOwnProfile && (
                    <span className="mb-2 inline-flex items-center rounded-full border border-[#dcc7a3] bg-[#fff9ef] px-3 py-1 text-xs font-semibold text-[#6b5630]">
                      {t("yourProfile")}
                    </span>
                  )}
                  <PlayerIdentityRow
                    player={profile}
                    currentPlayerId={auth?.player.playerId}
                    avatarClassName="h-24 w-24 border-4 border-[#e8d9c0] shadow-[0_20px_40px_-20px_rgba(63,37,17,0.4)]"
                    linkToProfile={false}
                    friendVariant="light"
                    nameClassName="font-display text-3xl font-bold text-[#2b1e14]"
                    className="justify-center gap-4"
                  />

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
            </PaperCard>
          </AnimatedCard>

          {/* Stats card */}
          {(profile.gamesPlayed ?? 0) > 0 && (
            <AnimatedCard delay={0.05} className="w-full">
              <PaperCard className="w-full">
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
              </PaperCard>
            </AnimatedCard>
          )}

          {/* Badges card */}
          {allBadges.length > 0 && (
            <AnimatedCard delay={0.1} className="w-full">
              <PaperCard className="w-full">
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
              </PaperCard>
            </AnimatedCard>
          )}

          {/* Achievements */}
          {playerAchievements.length > 0 && (
            <AnimatedCard delay={0.12} className="w-full">
              <PaperCard className="w-full">
                <CardContent className="py-6">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-[#8d7760]">
                      {t("achievements")}
                    </h2>
                    <button
                      onClick={() => router.push(`/achievements`)}
                      className="inline-flex items-center gap-2 text-xs text-[#8b7356] hover:underline"
                    >
                      <span>{t("viewYourOwnAchievements")}</span>
                      <span aria-hidden="true">&rarr;</span>
                    </button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {playerAchievements.slice(0, 6).map((pa) => {
                      const def = ACHIEVEMENTS.find((a) => a.id === pa.achievementId);
                      if (!def) return null;
                      return (
                        <AchievementCard
                          key={pa.achievementId}
                          def={def}
                          unlocked
                          unlockedAt={pa.unlockedAt}
                        />
                      );
                    })}
                  </div>
                  {playerAchievements.length > 6 && (
                    <p className="mt-3 text-center text-xs text-[#a89a7e]">
                      +{playerAchievements.length - 6} more
                    </p>
                  )}
                </CardContent>
              </PaperCard>
            </AnimatedCard>
          )}

          {/* Match history */}
          {matchHistory.length > 0 && (matchPlayerId || auth?.player.playerId) && (
            <AnimatedCard delay={0.15} className="w-full">
              <PaperCard className="w-full">
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
                        playerName={isOwnProfile ? undefined : (profile?.displayName ?? undefined)}
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
              </PaperCard>
            </AnimatedCard>
          )}
        </>
      )}
    </PageLayout>
  );
}
