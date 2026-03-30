"use client";
import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { useAuth } from "@/lib/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  getPublicProfile,
  sendFriendRequest,
  acceptFriendRequest,
  type PublicProfile,
} from "@/lib/api";
import { PlayerOverviewAvatar } from "@/components/game/GameShared";
import { UserBadge, type BadgeId, BADGE_DEFINITIONS } from "@/components/UserBadge";
import { resolvePlayerBadges } from "@/lib/featureGate";
import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

export function PublicProfilePage() {
  const t = useTranslations("publicProfile");
  const tCommon = useTranslations("common");
  const { auth, onOpenAuth, onLogout } = useAuth();
  const router = useRouter();
  const params = useParams<{ username: string }>();
  const [navOpen, setNavOpen] = useState(false);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [friendStatus, setFriendStatus] = useState<PublicProfile["friendshipStatus"]>();
  const [friendActionBusy, setFriendActionBusy] = useState(false);

  useEffect(() => {
    if (!params?.username) return;
    setLoading(true);
    setError(null);
    getPublicProfile(decodeURIComponent(params.username))
      .then((res) => {
        setProfile(res.profile);
        setFriendStatus(res.profile.friendshipStatus);
      })
      .catch(() => setError("not-found"))
      .finally(() => setLoading(false));
  }, [params?.username]);

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
        <Button
          variant="ghost"
          className="self-start text-[#8b7356]"
          onClick={() => router.push("/")}
        >
          &larr; {tCommon("backToLobby")}
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
                  <div className="flex items-center justify-center gap-2">
                    <h1 className="font-display text-3xl font-bold text-[#2b1e14]">
                      {profile.displayName}
                    </h1>
                    {activeBadges.map((id) => (
                      <UserBadge key={id} badge={id as BadgeId} />
                    ))}
                  </div>

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
                        date: new Date(profile.createdAt).toLocaleDateString(undefined, {
                          month: "long",
                          year: "numeric",
                        }),
                        days: memberDays ?? 0,
                      })}
                    </p>
                  )}

                  {auth?.player && friendStatus === "none" && profile.playerId && (
                    <Button
                      className="mt-4"
                      disabled={friendActionBusy}
                      onClick={async () => {
                        setFriendActionBusy(true);
                        try {
                          await sendFriendRequest(profile.playerId!);
                          setFriendStatus("outgoing-request");
                        } finally {
                          setFriendActionBusy(false);
                        }
                      }}
                    >
                      {t("addFriend")}
                    </Button>
                  )}

                  {auth?.player && friendStatus === "incoming-request" && profile.playerId && (
                    <Button
                      className="mt-4"
                      disabled={friendActionBusy}
                      onClick={async () => {
                        setFriendActionBusy(true);
                        try {
                          await acceptFriendRequest(profile.playerId!);
                          setFriendStatus("friend");
                        } finally {
                          setFriendActionBusy(false);
                        }
                      }}
                    >
                      {t("acceptRequest")}
                    </Button>
                  )}

                  {friendStatus === "outgoing-request" && (
                    <p className="mt-4 inline-flex items-center rounded-xl border border-[#dcc7a3] bg-[#fff9ef] px-4 py-2 text-sm font-medium text-[#4e3d2c]">
                      {t("requestSent")}
                    </p>
                  )}

                  {friendStatus === "friend" && (
                    <p className="mt-4 inline-flex items-center rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">
                      {t("alreadyFriends")}
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
                      {profile.favoriteBoard && (
                        <span className="rounded-lg border border-[#dcc7a3] bg-[#fff9ef] px-3 py-1.5 text-xs text-[#4e3d2c]">
                          {t("favoriteBoard", { size: profile.favoriteBoard })}
                        </span>
                      )}
                      {profile.favoriteTimeControl && (
                        <span className="rounded-lg border border-[#dcc7a3] bg-[#fff9ef] px-3 py-1.5 text-xs text-[#4e3d2c]">
                          {t("favoriteTimeControl", { tc: profile.favoriteTimeControl })}
                        </span>
                      )}
                      {profile.favoriteScore && (
                        <span className="rounded-lg border border-[#dcc7a3] bg-[#fff9ef] px-3 py-1.5 text-xs text-[#4e3d2c]">
                          {t("favoriteScore", { score: profile.favoriteScore })}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="mt-5 flex justify-center gap-3">
                    <Link
                      href={`/games?player=${encodeURIComponent(profile.displayName)}`}
                      className="text-xs font-medium text-[#8b7356] hover:text-[#4e3d2c] hover:underline"
                    >
                      {t("viewGameHistory")} &rarr;
                    </Link>
                  </div>
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
          </>
        )}
      </main>
    </div>
  );
}
