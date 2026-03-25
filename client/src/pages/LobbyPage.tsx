import React, { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import type {
  AuthResponse,
  MultiplayerSnapshot,
  MultiplayerGameSummary,
} from "@shared";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Navbar } from "@/components/Navbar";
import {
  getOpponentLabel,
  isSummaryYourTurn,
} from "@/components/game/GameShared";
import { useGamesIndex } from "@/lib/hooks/useGamesIndex";
import { useSocialData } from "@/lib/hooks/useSocialData";
import { useLobbyMessage } from "@/lib/LobbySocketContext";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createMultiplayerGame, joinMultiplayerGame } from "@/lib/api";
import { toastError } from "@/lib/errors";

type LobbyPageProps = {
  auth: AuthResponse | null;
  onOpenAuth: (mode: "login" | "signup") => void;
  onLogout: () => void;
};

export function LobbyPage({ auth, onOpenAuth, onLogout }: LobbyPageProps) {
  const navigate = useNavigate();
  const { multiplayerGames, refreshMultiplayerGames } = useGamesIndex(auth);

  const { socialOverview, refreshSocialOverview } = useSocialData(auth, true);

  // Real-time updates for lobby
  useLobbyMessage((payload) => {
    if (payload.type === "game-update") {
      void refreshMultiplayerGames({ silent: true });

      const inGame = window.location.pathname.startsWith("/game/");
      if (
        payload.summary.status === "active" &&
        payload.summary.yourSeat === payload.summary.currentTurn &&
        !inGame
      ) {
        const opponentSeat = payload.summary.yourSeat === "white" ? "black" : "white";
        const opponentName = payload.summary.seats[opponentSeat]?.player.displayName || "your opponent";
        toast.info(`Your move in ${payload.summary.gameId}`, {
          id: `your-turn-${payload.summary.gameId}`,
          description: `It's your turn against ${opponentName}.`,
          action: {
            label: "Join Game",
            onClick: () => window.location.assign(`/game/${payload.summary.gameId}`),
          },
        });
      }
    }
    if (payload.type === "social-update") {
      void refreshSocialOverview({ silent: true, allowInviteToast: true });
    }
  });

  const [navOpen, setNavOpen] = useState(false);
  const [joinGameId, setJoinGameId] = useState("");
  const [multiplayerBusy, setMultiplayerBusy] = useState(false);

  const activeGames = multiplayerGames.active ?? [];
  const sortedActiveGames = useMemo(() => {
    return [...activeGames].sort((a, b) => {
      const aYourTurn = isSummaryYourTurn(a);
      const bYourTurn = isSummaryYourTurn(b);
      if (aYourTurn && !bYourTurn) return -1;
      if (!aYourTurn && bYourTurn) return 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [activeGames]);

  async function handleCreateRoom() {
    if (!auth) {
      onOpenAuth("login");
      return;
    }

    setMultiplayerBusy(true);
    try {
      const response = await createMultiplayerGame();
      navigate(`/game/${response.snapshot.gameId}`);
    } catch (error) {
      toastError(error);
    } finally {
      setMultiplayerBusy(false);
    }
  }

  async function handleJoinRoom() {
    if (!auth) {
      onOpenAuth("login");
      return;
    }

    if (!joinGameId.trim()) {
      return;
    }

    setMultiplayerBusy(true);
    try {
      const response = await joinMultiplayerGame(
        joinGameId.trim().toUpperCase(),
      );
      navigate(`/game/${response.snapshot.gameId}`);
    } catch (error) {
      toastError(error);
    } finally {
      setMultiplayerBusy(false);
    }
  }

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

      <main className="mx-auto flex max-w-7xl flex-col gap-8 px-4 pb-12 pt-20 sm:px-6 lg:px-8 lg:pt-20">
        {/* Banner Section */}
        <section className="relative flex flex-col items-center justify-center py-12 text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center gap-4"
          >
            <span className="flex h-24 w-24 items-center justify-center rounded-[2.5rem] border-2 border-[#f6e8cf]/55 bg-[linear-gradient(180deg,#faefd8,#ecd4a6)] font-display text-6xl text-[#25170d] shadow-[0_32px_64px_-24px_rgba(37,23,13,0.85)]">
              跳
            </span>
            <h1 className="font-display text-7xl tracking-tighter text-[#2f2015]">
              Tiao
            </h1>
            <p className="max-w-md text-lg font-medium text-[#6e5b48]/80">
              A beautiful abstract strategy game. Play online, with friends, or
              against an AI.
            </p>
          </motion.div>
        </section>

        <section className="grid gap-8 lg:grid-cols-2">
          {/* Local Match Card */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Card
              className={cn(
                "h-full overflow-hidden flex flex-col shadow-xl",
                paperCard,
              )}
            >
              <div className="h-2 bg-[linear-gradient(90deg,#4b3726,#b98d49)]" />
              <CardHeader className="pb-8">
                <Badge className="w-fit bg-[#f4e8d2] text-[#6c543c] mb-2">
                  Local
                </Badge>
                <CardTitle className="text-4xl text-[#2b1e14]">
                  Over the Board
                </CardTitle>
                <CardDescription className="text-base text-[#6e5b48] mt-2">
                  Play a match on the same board with a friend or practice
                  against an AI opponent.
                </CardDescription>
              </CardHeader>
              <CardContent className="mt-auto grid grid-cols-2 gap-4 pb-8">
                <Button
                  size="lg"
                  variant="secondary"
                  className="w-full h-14 text-lg border-[#dcc7a2]"
                  onClick={() => navigate("/computer")}
                >
                  Play with a Bot
                </Button>
                <Button
                  size="lg"
                  className="w-full h-14 text-lg"
                  onClick={() => navigate("/local")}
                >
                  Play with a Friend
                </Button>
              </CardContent>
            </Card>
          </motion.div>

          {/* Online Match Card */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Card
              className={cn(
                "h-full overflow-hidden flex flex-col shadow-xl",
                paperCard,
              )}
            >
              <div className="h-2 bg-[linear-gradient(90deg,#6e4f29,#d2a661)]" />
              <CardHeader className="pb-8">
                <Badge className="w-fit bg-[#f5ead8] text-[#6e5437] mb-2">
                  Online
                </Badge>
                <CardTitle className="text-4xl text-[#2b1e14]">
                  Play Online
                </CardTitle>
                <CardDescription className="text-base text-[#6e5b48] mt-2">
                  Find a quick match or create a private game for a person that
                  you know or join theirs.
                </CardDescription>
              </CardHeader>
              <CardContent className="mt-auto space-y-10 pb-8">
                <Button
                  size="lg"
                  className="w-full h-16 text-xl shadow-lg bg-[linear-gradient(180deg,#4b3726,#2b1e14)] hover:shadow-xl transition-all"
                  onClick={() => navigate("/matchmaking")}
                >
                  Quick match
                </Button>

                <div className="space-y-6">
                  <div className="flex items-center gap-4 text-xs font-bold uppercase tracking-[0.25em] text-[#8d7760]">
                    <span className="h-px flex-1 bg-[#dcc7a2]" />
                    Against someone specific
                    <span className="h-px flex-1 bg-[#dcc7a2]" />
                  </div>

                  <div className="flex flex-wrap sm:flex-nowrap items-center gap-3">
                    <Button
                      variant="secondary"
                      className="flex-1 h-12 text-base border-[#dcc7a2]"
                      onClick={handleCreateRoom}
                      disabled={multiplayerBusy}
                    >
                      {multiplayerBusy ? "Creating..." : "Create game"}
                    </Button>
                    <span className="text-[#8d7760] font-bold italic px-1">
                      or
                    </span>
                    <div className="flex flex-[1.5] gap-1">
                      <Input
                        value={joinGameId}
                        onChange={(e) =>
                          setJoinGameId(
                            e.target.value
                              .toUpperCase()
                              .replace(/[^A-Z0-9]/g, ""),
                          )
                        }
                        placeholder="Existing Game ID"
                        maxLength={6}
                        className="h-12 font-mono bg-white/60 border-[#dcc7a2] focus:ring-[#b98d49]"
                      />
                      <Button
                        variant="outline"
                        className="h-12 px-6 border-[#dcc7a2] hover:bg-[#faefd8]"
                        onClick={handleJoinRoom}
                        disabled={multiplayerBusy || !joinGameId}
                      >
                        Join
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </section>

        {auth?.player?.kind === "account" && (
          <section className="grid gap-8 lg:grid-cols-2 mt-4">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Card className={cn("overflow-hidden shadow-lg", paperCard)}>
                <CardHeader className="flex-row items-center justify-between border-b border-black/5 bg-black/2 py-4">
                  <CardTitle className="text-2xl text-[#2b1e14]">
                    Active games
                  </CardTitle>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="bg-[#f4e8d2] hover:bg-[#ecd4a6] border-[#dcc7a2] text-[#6c543c]"
                    onClick={() => navigate("/games")}
                  >
                    View all
                  </Button>
                </CardHeader>
                <CardContent className="space-y-3 pt-6">
                  {sortedActiveGames.slice(0, 3).map((game) => {
                    const isYourTurn = isSummaryYourTurn(game);
                    return (
                      <div
                        key={game.gameId}
                        className="flex items-center justify-between rounded-2xl border border-[#d7c39e] bg-[#fffaf3] p-4 shadow-sm hover:border-[#b98d49] transition-colors group"
                      >
                        <div className="flex items-center gap-4">
                          <div className="flex flex-col">
                            <p className="font-mono text-lg font-bold text-[#2b1e14]">
                              {game.gameId}
                            </p>
                            <p className="text-sm text-[#6e5b48]">
                              vs {getOpponentLabel(game, auth.player.playerId)}
                            </p>
                          </div>
                          <Badge
                            className={cn(
                              "ml-2 px-3 py-1",
                              isYourTurn
                                ? "bg-[#e8f2d8] text-[#4b6537] animate-pulse"
                                : "bg-[#f3e7d5] text-[#6b563e]",
                            )}
                          >
                            {isYourTurn ? "Your move" : "Their move"}
                          </Badge>
                        </div>
                        <Button
                          size="sm"
                          className="shadow-sm group-hover:scale-105 transition-transform"
                          onClick={() => navigate(`/game/${game.gameId}`)}
                        >
                          Resume
                        </Button>
                      </div>
                    );
                  })}
                  {sortedActiveGames.length === 0 && (
                    <p className="text-center text-sm text-[#6e5b48] py-8 bg-white/20 rounded-2xl border border-dashed border-[#dcc7a2]">
                      No active games yet. Try Quick Match!
                    </p>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Card className={cn("overflow-hidden shadow-lg", paperCard)}>
                <CardHeader className="flex-row items-center justify-between border-b border-black/5 bg-black/2 py-4">
                  <CardTitle className="text-2xl text-[#2b1e14]">
                    Invitations
                  </CardTitle>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="bg-[#f4e8d2] hover:bg-[#ecd4a6] border-[#dcc7a2] text-[#6c543c]"
                    onClick={() => refreshSocialOverview()}
                  >
                    Refresh
                  </Button>
                </CardHeader>
                <CardContent className="space-y-3 pt-6">
                  {socialOverview.incomingInvitations.slice(0, 3).map((inv) => (
                    <div
                      key={inv.id}
                      className="flex items-center justify-between rounded-2xl border border-[#dcc7a2] bg-[#fffdf7] p-4 shadow-sm hover:border-[#b98d49] transition-colors group"
                    >
                      <div className="flex items-center gap-4">
                        <div className="flex flex-col">
                          <p className="font-semibold text-lg text-[#2b1e14]">
                            {inv.sender.displayName}
                          </p>
                          <p className="text-sm text-[#7a6656]">
                            Game {inv.gameId}
                          </p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        className="shadow-sm group-hover:scale-105 transition-transform"
                        onClick={() => navigate(`/game/${inv.gameId}`)}
                      >
                        Accept
                      </Button>
                    </div>
                  ))}
                  {socialOverview.incomingInvitations.length === 0 && (
                    <p className="text-center text-sm text-[#6e5b48] py-8 bg-white/20 rounded-2xl border border-dashed border-[#dcc7a2]">
                      No invitations right now.
                    </p>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </section>
        )}
      </main>
    </div>
  );
}
