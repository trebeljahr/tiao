import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import type { AuthResponse } from "@shared";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Navbar } from "@/components/Navbar";
import {
  getOpponentLabel,
  getSummaryStatusLabel,
  isSummaryYourTurn,
  formatGameTimestamp,
} from "@/components/game/GameShared";
import { useGamesIndex } from "@/lib/hooks/useGamesIndex";
import { useLobbySocket } from "@/lib/hooks/useLobbySocket";
import { cn } from "@/lib/utils";

type GamesPageProps = {
  auth: AuthResponse | null;
  onOpenAuth: (mode: "login" | "signup") => void;
  onLogout: () => void;
};

export function GamesPage({ auth, onOpenAuth, onLogout }: GamesPageProps) {
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);

  const {
    multiplayerGames,
    multiplayerGamesLoading,
    refreshMultiplayerGames,
  } = useGamesIndex(auth);

  // Real-time updates for games page
  useLobbySocket(
    auth,
    () => void refreshMultiplayerGames({ silent: true }),
    () => {},
  );

  const paperCard =
    "border-[#d0bb94]/75 bg-[linear-gradient(180deg,rgba(255,250,242,0.96),rgba(244,231,207,0.94))]";

  if (!auth || auth.player.kind !== "account") {
    return (
      <div className="relative min-h-screen overflow-hidden">
        <Navbar mode="lobby" auth={auth} navOpen={navOpen} onToggleNav={() => setNavOpen(!navOpen)} onCloseNav={() => setNavOpen(false)} onGoLobby={() => navigate("/")} onGoOverTheBoard={() => navigate("/local")} onGoMultiplayer={() => navigate("/multiplayer")} onGoComputer={() => navigate("/computer")} onGoProfile={() => navigate("/profile")} onOpenAuth={onOpenAuth} onLogout={onLogout} />
        <main className="mx-auto max-w-2xl px-4 pt-32">
          <Card className={paperCard}>
            <CardHeader><CardTitle>Account Required</CardTitle></CardHeader>
            <CardContent><p>Please sign in to view your games.</p><Button className="mt-4" onClick={() => onOpenAuth("login")}>Sign In</Button></CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[18rem] bg-[radial-gradient(circle_at_top,_rgba(255,247,231,0.76),_transparent_58%)]" />

      <Navbar
        mode="lobby"
        auth={auth}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen(!navOpen)}
        onCloseNav={() => setNavOpen(false)}
        onGoLobby={() => navigate("/")}
        onGoOverTheBoard={() => navigate("/local")}
        onGoMultiplayer={() => navigate("/multiplayer")}
        onGoComputer={() => navigate("/computer")}
        onGoProfile={() => navigate("/profile")}
        onOpenAuth={onOpenAuth}
        onLogout={onLogout}
      />

      <main className="mx-auto flex max-w-5xl flex-col gap-5 px-4 pb-5 pt-20 sm:px-6 lg:px-8 lg:pb-6 lg:pt-20">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-display font-bold text-[#2b1e14]">My Games</h1>
          <Button variant="secondary" onClick={() => refreshMultiplayerGames()} disabled={multiplayerGamesLoading}>
            {multiplayerGamesLoading ? "Refreshing..." : "Refresh"}
          </Button>
        </div>

        <section className="space-y-6">
          <Card className={paperCard}>
            <CardHeader>
              <CardTitle>Active Games</CardTitle>
              <CardDescription>Ongoing matches waiting for a move.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {multiplayerGames.active.map(game => {
                const isYourTurn = isSummaryYourTurn(game);
                return (
                  <div key={game.gameId} className="flex items-center justify-between p-4 rounded-2xl border border-[#d7c39e] bg-white/40">
                    <div>
                      <p className="font-mono font-bold text-lg">{game.gameId}</p>
                      <p className="text-sm text-[#6e5b48]">vs {getOpponentLabel(game, auth.player.playerId)}</p>
                      <Badge className={cn(
                        "mt-2",
                        isYourTurn
                          ? "bg-[#e8f2d8] text-[#4b6537] animate-pulse"
                          : "bg-[#f3e7d5] text-[#6b563e]",
                      )}>
                        {getSummaryStatusLabel(game)}
                      </Badge>
                    </div>
                    <Button onClick={() => navigate(`/game/${game.gameId}`)}>Resume</Button>
                  </div>
                );
              })}
              {multiplayerGames.active.length === 0 && <p className="col-span-full py-8 text-center text-sm text-[#6e5b48]">No active games.</p>}
            </CardContent>
          </Card>

          <Card className={paperCard}>
            <CardHeader>
              <CardTitle>Match History</CardTitle>
              <CardDescription>Your recently completed matches.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {multiplayerGames.finished.map(game => (
                <div key={game.gameId} className="flex items-center justify-between p-4 rounded-2xl border border-[#d7c39e] bg-white/40 opacity-80">
                  <div>
                    <p className="font-mono font-bold">{game.gameId}</p>
                    <p className="text-xs text-[#6e5b48]">{formatGameTimestamp(game.updatedAt)}</p>
                    <p className="text-sm font-medium mt-1">{getSummaryStatusLabel(game)}</p>
                  </div>
                  <Button variant="outline" onClick={() => navigate(`/game/${game.gameId}`)}>Review</Button>
                </div>
              ))}
              {multiplayerGames.finished.length === 0 && <p className="col-span-full py-8 text-center text-sm text-[#6e5b48]">No completed matches yet.</p>}
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}
