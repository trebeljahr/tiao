"use client";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { RequireAccount } from "@/components/RequireAccount";
import { useAuth } from "@/lib/AuthContext";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PaperCard } from "@/components/ui/paper-card";
import { AnimatedCard } from "@/components/ui/animated-card";
import { MatchHistoryCard } from "@/components/game/MatchHistoryCard";
import { ActiveGamesList } from "@/components/game/ActiveGamesList";
import { Navbar } from "@/components/Navbar";
import { SkeletonCard } from "@/components/ui/skeleton";
import { useGamesIndex } from "@/lib/hooks/useGamesIndex";
import { useLobbyMessage } from "@/lib/LobbySocketContext";
import { useTranslations } from "next-intl";

export function GamesPage() {
  const t = useTranslations("games");
  const { auth, onOpenAuth, onLogout } = useAuth();
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);

  const { multiplayerGames, multiplayerGamesLoaded, refreshMultiplayerGames } = useGamesIndex(auth);

  // Real-time updates for games page
  useLobbyMessage((payload) => {
    if (payload.type === "game-update" || payload.type === "game-removed") {
      void refreshMultiplayerGames({ silent: true });
    }
  });

  const finishedGamesWithRematch = useMemo(
    () => multiplayerGames.finished.filter((g) => g.rematch?.requestedBy.length && g.yourSeat),
    [multiplayerGames.finished],
  );

  return (
    <RequireAccount>
      {() => (
        <div className="relative min-h-screen overflow-hidden">
          <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 bg-[radial-gradient(circle_at_top,rgba(255,247,231,0.76),transparent_58%)]" />

          <Navbar
            auth={auth}
            navOpen={navOpen}
            onToggleNav={() => setNavOpen(!navOpen)}
            onCloseNav={() => setNavOpen(false)}
            onOpenAuth={onOpenAuth}
            onLogout={onLogout}
          />

          <main className="mx-auto flex max-w-5xl flex-col gap-5 px-4 pb-5 pt-20 sm:px-6 lg:px-8 lg:pb-6 lg:pt-20">
            <div className="flex items-center justify-between">
              <h1 className="text-3xl font-display font-bold text-[#2b1e14]">{t("title")}</h1>
            </div>

            <section className="space-y-6">
              {!multiplayerGamesLoaded ? (
                <>
                  <SkeletonCard rows={2} />
                  <SkeletonCard rows={3} />
                </>
              ) : (
                <>
                  <AnimatedCard delay={0}>
                    <PaperCard>
                      <CardHeader>
                        <CardTitle>{t("activeGames")}</CardTitle>
                        <CardDescription>{t("activeGamesDesc")}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <ActiveGamesList
                          games={multiplayerGames.active}
                          finishedGamesWithRematch={finishedGamesWithRematch}
                          refreshGames={refreshMultiplayerGames}
                        />
                      </CardContent>
                    </PaperCard>
                  </AnimatedCard>

                  <AnimatedCard delay={0.05}>
                    <PaperCard>
                      <CardHeader>
                        <CardTitle>{t("matchHistory")}</CardTitle>
                        <CardDescription>{t("matchHistoryDesc")}</CardDescription>
                      </CardHeader>
                      <CardContent className="grid gap-3">
                        {multiplayerGames.finished.map((game) => (
                          <MatchHistoryCard
                            key={game.gameId}
                            game={game}
                            playerId={auth!.player.playerId}
                            onReview={() => router.push(`/game/${game.gameId}`)}
                          />
                        ))}
                        {multiplayerGames.finished.length === 0 && (
                          <p className="col-span-full py-8 text-center text-sm text-[#6e5b48]">
                            {t("noMatchHistory")}
                          </p>
                        )}
                      </CardContent>
                    </PaperCard>
                  </AnimatedCard>
                </>
              )}
            </section>
          </main>
        </div>
      )}
    </RequireAccount>
  );
}
