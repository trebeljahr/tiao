"use client";
import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { RequireAccount } from "@/components/RequireAccount";
import { useAuth } from "@/lib/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MatchHistoryCard } from "@/components/game/MatchHistoryCard";
import { ActiveGameCard } from "@/components/game/ActiveGameCard";
import { isSummaryYourTurn } from "@/components/game/GameShared";
import { Navbar } from "@/components/Navbar";
import { useGamesIndex } from "@/lib/hooks/useGamesIndex";
import { useLobbyMessage } from "@/lib/LobbySocketContext";
import { cancelMultiplayerGame } from "@/lib/api";
import { useTranslations } from "next-intl";

export function GamesPage() {
  const t = useTranslations("games");
  const { auth, onOpenAuth, onLogout } = useAuth();
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { multiplayerGames, refreshMultiplayerGames } = useGamesIndex(auth);

  // Real-time updates for games page
  useLobbyMessage((payload) => {
    if (payload.type === "game-update") {
      void refreshMultiplayerGames({ silent: true });
    }
  });

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDeleteGame = useCallback(
    async (gameId: string) => {
      setDeletingId(gameId);
      try {
        await cancelMultiplayerGame(gameId);
        void refreshMultiplayerGames({ silent: true });
      } catch {
        // best-effort
      } finally {
        setDeletingId(null);
      }
    },
    [refreshMultiplayerGames],
  );

  const handleCopy = useCallback((gameId: string) => {
    void navigator.clipboard.writeText(gameId);
    setCopiedId(gameId);
    setTimeout(() => setCopiedId((prev) => (prev === gameId ? null : prev)), 1800);
  }, []);

  const paperCard =
    "border-[#d0bb94]/75 bg-[linear-gradient(180deg,rgba(255,250,242,0.96),rgba(244,231,207,0.94))]";

  return (
    <RequireAccount>
      {() => (
        <div className="relative min-h-screen overflow-hidden">
          <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[18rem] bg-[radial-gradient(circle_at_top,_rgba(255,247,231,0.76),_transparent_58%)]" />

          <Navbar
            mode="lobby"
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
              <Card className={paperCard}>
                <CardHeader>
                  <CardTitle>{t("activeGames")}</CardTitle>
                  <CardDescription>{t("activeGamesDesc")}</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2">
                  {[...multiplayerGames.active]
                    .sort((a, b) => {
                      const aYourTurn = isSummaryYourTurn(a) ? 1 : 0;
                      const bYourTurn = isSummaryYourTurn(b) ? 1 : 0;
                      if (aYourTurn !== bYourTurn) return bYourTurn - aYourTurn;
                      const aOpponentOnline =
                        (a.yourSeat === "white" ? a.seats.black : a.seats.white)?.online ?? false;
                      const bOpponentOnline =
                        (b.yourSeat === "white" ? b.seats.black : b.seats.white)?.online ?? false;
                      if (aOpponentOnline !== bOpponentOnline) return aOpponentOnline ? -1 : 1;
                      return 0;
                    })
                    .map((game) => (
                      <ActiveGameCard
                        key={game.gameId}
                        game={game}
                        onResume={() => router.push(`/game/${game.gameId}`)}
                        onDelete={() => handleDeleteGame(game.gameId)}
                        deleting={deletingId === game.gameId}
                      />
                    ))}
                  {multiplayerGames.active.length === 0 && (
                    <p className="col-span-full py-8 text-center text-sm text-[#6e5b48]">
                      {t("noActiveGames")}
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card className={paperCard}>
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
                      copiedId={copiedId}
                      onCopy={() => handleCopy(game.gameId)}
                      onReview={() => router.push(`/game/${game.gameId}`)}
                    />
                  ))}
                  {multiplayerGames.finished.length === 0 && (
                    <p className="col-span-full py-8 text-center text-sm text-[#6e5b48]">
                      {t("noMatchHistory")}
                    </p>
                  )}
                </CardContent>
              </Card>
            </section>
          </main>
        </div>
      )}
    </RequireAccount>
  );
}
