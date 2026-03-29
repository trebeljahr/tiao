import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { useAuth } from "@/lib/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getPublicProfile, type PublicProfile } from "@/lib/api";
import { PlayerOverviewAvatar } from "@/components/game/GameShared";
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

  useEffect(() => {
    if (!params?.username) return;
    setLoading(true);
    setError(null);
    getPublicProfile(decodeURIComponent(params.username))
      .then((res) => setProfile(res.profile))
      .catch(() => setError("not-found"))
      .finally(() => setLoading(false));
  }, [params?.username]);

  const paperCard =
    "border-[#d0bb94]/75 bg-[linear-gradient(180deg,rgba(255,250,242,0.96),rgba(244,231,207,0.94))]";

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
          <Card className={paperCard + " w-full"}>
            <CardContent className="flex flex-col items-center gap-6 pt-8 pb-8">
              <PlayerOverviewAvatar
                player={profile}
                className="h-24 w-24 border-4 border-[#e8d9c0] shadow-[0_20px_40px_-20px_rgba(63,37,17,0.4)]"
              />

              <div className="text-center">
                <h1 className="font-display text-3xl font-bold text-[#2b1e14]">
                  {profile.displayName}
                </h1>
                {profile.createdAt && (
                  <p className="mt-1 text-sm text-[#8d7760]">
                    {t("playingSince", {
                      date: new Date(profile.createdAt).toLocaleDateString(undefined, {
                        month: "long",
                        year: "numeric",
                      }),
                    })}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
