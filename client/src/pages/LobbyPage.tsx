import React, { useState, useMemo, useRef } from "react";
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

const TIME_CONTROL_PRESETS = [
  {
    label: "1+0",
    category: "Bullet",
    timeControl: { initialMs: 60_000, incrementMs: 0 },
  },
  {
    label: "2+1",
    category: "Bullet",
    timeControl: { initialMs: 120_000, incrementMs: 1_000 },
  },
  {
    label: "3+0",
    category: "Blitz",
    timeControl: { initialMs: 180_000, incrementMs: 0 },
  },
  {
    label: "3+2",
    category: "Blitz",
    timeControl: { initialMs: 180_000, incrementMs: 2_000 },
  },
  {
    label: "5+0",
    category: "Blitz",
    timeControl: { initialMs: 300_000, incrementMs: 0 },
  },
  {
    label: "5+3",
    category: "Blitz",
    timeControl: { initialMs: 300_000, incrementMs: 3_000 },
  },
  {
    label: "10+0",
    category: "Rapid",
    timeControl: { initialMs: 600_000, incrementMs: 0 },
  },
  {
    label: "15+10",
    category: "Rapid",
    timeControl: { initialMs: 900_000, incrementMs: 10_000 },
  },
  {
    label: "30+0",
    category: "Classical",
    timeControl: { initialMs: 1_800_000, incrementMs: 0 },
  },
] as const;

type LobbyPageProps = {
  auth: AuthResponse | null;
  onOpenAuth: (mode: "login" | "signup") => void;
  onLogout: () => void;
};

export function LobbyPage({ auth, onOpenAuth, onLogout }: LobbyPageProps) {
  const navigate = useNavigate();
  const { multiplayerGames, refreshMultiplayerGames } = useGamesIndex(auth);

  const { socialOverview, refreshSocialOverview, handleDeclineGameInvitation } =
    useSocialData(auth, true);

  // Track the last seen history length per game to avoid spurious "your move" toasts
  // (e.g. when leaving a game, the departure triggers a game-update but no new move).
  const seenHistoryRef = useRef<Record<string, number>>({});

  // Real-time updates for lobby
  useLobbyMessage((payload) => {
    if (payload.type === "game-update") {
      void refreshMultiplayerGames({ silent: true });

      const { summary } = payload;
      const prevLen = seenHistoryRef.current[summary.gameId] ?? 0;
      seenHistoryRef.current[summary.gameId] = summary.historyLength;

      const inGame = window.location.pathname.startsWith("/game/");
      const newMoveOccurred = summary.historyLength > prevLen;
      if (
        summary.status === "active" &&
        summary.yourSeat === summary.currentTurn &&
        !inGame &&
        newMoveOccurred
      ) {
        const opponentSeat = summary.yourSeat === "white" ? "black" : "white";
        const opponentName =
          summary.seats[opponentSeat]?.player.displayName || "your opponent";
        toast.info(`Your move in ${summary.gameId}`, {
          id: `your-turn-${summary.gameId}`,
          description: `It's your turn against ${opponentName}.`,
          action: {
            label: "Join Game",
            onClick: () => window.location.assign(`/game/${summary.gameId}`),
          },
        });
      }

      // Toast for incoming rematch requests
      if (
        summary.status === "finished" &&
        summary.rematch?.requestedBy.length &&
        summary.yourSeat &&
        !summary.rematch.requestedBy.includes(summary.yourSeat) &&
        !inGame
      ) {
        const opponentSeat = summary.yourSeat === "white" ? "black" : "white";
        const opponentName =
          summary.seats[opponentSeat]?.player.displayName || "your opponent";
        toast(`${opponentName} wants a rematch!`, {
          id: `rematch-${summary.gameId}`,
          description: `Game ${summary.gameId}`,
          action: {
            label: "View Game",
            onClick: () => window.location.assign(`/game/${summary.gameId}`),
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
  const [showGameSettings, setShowGameSettings] = useState(false);
  const [boardSize, setBoardSize] = useState(19);
  const [scoreToWin, setScoreToWin] = useState(10);
  const [showLocalSettings, setShowLocalSettings] = useState(false);
  const [localBoardSize, setLocalBoardSize] = useState(19);
  const [localScoreToWin, setLocalScoreToWin] = useState(10);

  function localGameSettingsParams() {
    if (localBoardSize === 19 && localScoreToWin === 10) return "";
    const params = new URLSearchParams();
    if (localBoardSize !== 19) params.set("boardSize", String(localBoardSize));
    if (localScoreToWin !== 10) params.set("scoreToWin", String(localScoreToWin));
    return `?${params}`;
  }

  const activeGames = multiplayerGames.active ?? [];
  const finishedGames = multiplayerGames.finished ?? [];
  const rematchGames = useMemo(() => {
    return finishedGames.filter(
      (g) =>
        g.rematch?.requestedBy.length &&
        g.yourSeat &&
        !g.rematch.requestedBy.includes(g.yourSeat),
    );
  }, [finishedGames]);
  const sortedActiveGames = useMemo(() => {
    const combined = [...activeGames, ...rematchGames];
    return combined.sort((a, b) => {
      // Rematch requests at the top
      const aRematch =
        a.status === "finished" && !!a.rematch?.requestedBy.length;
      const bRematch =
        b.status === "finished" && !!b.rematch?.requestedBy.length;
      if (aRematch && !bRematch) return -1;
      if (!aRematch && bRematch) return 1;
      const aYourTurn = isSummaryYourTurn(a);
      const bYourTurn = isSummaryYourTurn(b);
      if (aYourTurn && !bYourTurn) return -1;
      if (!aYourTurn && bYourTurn) return 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [activeGames, rematchGames]);

  async function handleCreateRoom() {
    if (!auth) {
      onOpenAuth("login");
      return;
    }

    setMultiplayerBusy(true);
    try {
      const settings =
        boardSize !== 19 || scoreToWin !== 10
          ? { boardSize, scoreToWin }
          : undefined;
      const response = await createMultiplayerGame(settings);
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

      <main className="mx-auto flex max-w-7xl flex-col px-4 pb-12 pt-16 sm:px-6 lg:px-8 lg:pt-20">
        {/* Banner Section — hidden for users who completed the tutorial */}
        {!(
          (auth?.player.kind === "account" && auth.player.hasSeenTutorial) ||
          localStorage.getItem("tiao:tutorialComplete")
        ) && (
          <section className="relative flex flex-col items-center justify-center py-4 text-center sm:py-12">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-2 sm:gap-4"
            >
              <span className="flex h-16 w-16 items-center justify-center rounded-[1.5rem] border-2 border-[#f6e8cf]/55 bg-[linear-gradient(180deg,#faefd8,#ecd4a6)] font-display text-4xl text-[#25170d] shadow-[0_32px_64px_-24px_rgba(37,23,13,0.85)] sm:h-24 sm:w-24 sm:rounded-[2.5rem] sm:text-6xl">
                跳
              </span>
              <h1 className="font-display text-5xl tracking-tighter text-[#2f2015] sm:text-7xl">
                Tiao
              </h1>
              <p className="max-w-md text-sm font-medium text-[#6e5b48]/80 sm:text-lg">
                A beautiful abstract strategy game. Play online, with friends,
                or against an AI.
              </p>
              <Button
                variant="ghost"
                className="text-[#b98d49] hover:text-[#8d6a2f] hover:bg-[#f4e8d2] font-semibold"
                onClick={() => navigate("/tutorial")}
              >
                New here? Learn to play →
              </Button>
            </motion.div>
          </section>
        )}

        <section className="mt-6 columns-1 gap-6 md:mt-8 md:columns-2 xl:columns-none xl:grid xl:grid-cols-3 [&>*]:mb-6 xl:[&>*]:mb-0">
          {/* Local — Over the Board */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="break-inside-avoid xl:flex xl:flex-col"
          >
            <Card className={cn("overflow-hidden shadow-xl xl:flex-1", paperCard)}>
              <div className="h-2 bg-[linear-gradient(90deg,#4b3726,#b98d49)]" />
              <CardHeader className="pb-6">
                <Badge className="w-fit bg-[#f4e8d2] text-[#6c543c] mb-2">
                  Local
                </Badge>
                <CardTitle className="text-3xl text-[#2b1e14]">
                  Over the Board
                </CardTitle>
                <CardDescription className="text-sm text-[#6e5b48] mt-1 md:hidden xl:block">
                  Share a screen with a friend or sharpen your skills against an
                  AI.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-6 pb-6">
                <Button
                  size="lg"
                  className="w-full h-12 text-base"
                  onClick={() => {
                    const params = localGameSettingsParams();
                    navigate(`/local${params}`);
                  }}
                >
                  Play with a Friend
                </Button>

                <div className="flex items-center gap-3 text-xs font-bold uppercase tracking-[0.2em] text-[#8d7760]">
                  <span className="h-px flex-1 bg-[#dcc7a2]" />
                  or
                  <span className="h-px flex-1 bg-[#dcc7a2]" />
                </div>

                <Button
                  size="lg"
                  variant="secondary"
                  className="w-full h-12 text-base border-[#dcc7a2]"
                  onClick={() => {
                    const params = localGameSettingsParams();
                    navigate(`/computer${params}`);
                  }}
                >
                  Play with a Bot
                </Button>

                <button
                  type="button"
                  className="flex w-full items-center justify-center gap-1.5 text-xs text-[#8d7760] hover:text-[#6e5437] transition-colors"
                  onClick={() => setShowLocalSettings((v) => !v)}
                >
                  <svg
                    viewBox="0 0 16 16"
                    className={cn(
                      "h-3 w-3 transition-transform",
                      showLocalSettings && "rotate-90",
                    )}
                    fill="currentColor"
                  >
                    <path d="M6 3l5 5-5 5V3z" />
                  </svg>
                  Game Settings
                  {(localBoardSize !== 19 || localScoreToWin !== 10) && (
                    <span className="text-[#b98d49]">
                      ({localBoardSize}x{localBoardSize}, {localScoreToWin} to win)
                    </span>
                  )}
                </button>

                {showLocalSettings && (
                  <div className="space-y-3 rounded-lg border border-[#dcc7a2] bg-white/40 p-3">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-[#6e5437]">
                        Board Size
                      </label>
                      <div className="flex gap-2">
                        {[9, 13, 19].map((size) => (
                          <Button
                            key={size}
                            variant={localBoardSize === size ? "default" : "outline"}
                            size="sm"
                            className={cn(
                              "flex-1",
                              localBoardSize === size
                                ? ""
                                : "border-[#dcc7a2] hover:bg-[#faefd8]",
                            )}
                            onClick={() => setLocalBoardSize(size)}
                          >
                            {size}x{size}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-[#6e5437]">
                        Score to Win
                      </label>
                      <div className="flex gap-2">
                        {[5, 10, 15, 20].map((score) => (
                          <Button
                            key={score}
                            variant={localScoreToWin === score ? "default" : "outline"}
                            size="sm"
                            className={cn(
                              "flex-1",
                              localScoreToWin === score
                                ? ""
                                : "border-[#dcc7a2] hover:bg-[#faefd8]",
                            )}
                            onClick={() => setLocalScoreToWin(score)}
                          >
                            {score}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Online — Play Against Someone Specific */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="break-inside-avoid xl:flex xl:flex-col"
          >
            <Card className={cn("overflow-hidden shadow-xl xl:flex-1", paperCard)}>
              <div className="h-2 bg-[linear-gradient(90deg,#6e4f29,#d2a661)]" />
              <CardHeader className="pb-6">
                <Badge className="w-fit bg-[#f5ead8] text-[#6e5437] mb-2">
                  Online
                </Badge>
                <CardTitle className="text-3xl text-[#2b1e14]">
                  Play Someone Specific
                </CardTitle>
                <CardDescription className="text-sm text-[#6e5b48] mt-1 md:hidden xl:block">
                  Create a private game and share the code, or join a friend's
                  game with theirs.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 pb-6">
                <div className="space-y-3">
                  <Button
                    size="lg"
                    className="w-full h-12 text-base"
                    onClick={handleCreateRoom}
                    disabled={multiplayerBusy}
                  >
                    {multiplayerBusy ? "Creating..." : "Create a game"}
                  </Button>

                  <button
                    type="button"
                    className="flex w-full items-center justify-center gap-1.5 text-xs text-[#8d7760] hover:text-[#6e5437] transition-colors"
                    onClick={() => setShowGameSettings((v) => !v)}
                  >
                    <svg
                      viewBox="0 0 16 16"
                      className={cn(
                        "h-3 w-3 transition-transform",
                        showGameSettings && "rotate-90",
                      )}
                      fill="currentColor"
                    >
                      <path d="M6 3l5 5-5 5V3z" />
                    </svg>
                    Game Settings
                    {(boardSize !== 19 || scoreToWin !== 10) && (
                      <span className="text-[#b98d49]">
                        ({boardSize}x{boardSize}, {scoreToWin} to win)
                      </span>
                    )}
                  </button>

                  {showGameSettings && (
                    <div className="space-y-3 rounded-lg border border-[#dcc7a2] bg-white/40 p-3">
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-[#6e5437]">
                          Board Size
                        </label>
                        <div className="flex gap-2">
                          {[9, 13, 19].map((size) => (
                            <Button
                              key={size}
                              variant={boardSize === size ? "default" : "outline"}
                              size="sm"
                              className={cn(
                                "flex-1",
                                boardSize === size
                                  ? ""
                                  : "border-[#dcc7a2] hover:bg-[#faefd8]",
                              )}
                              onClick={() => setBoardSize(size)}
                            >
                              {size}x{size}
                            </Button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-[#6e5437]">
                          Score to Win
                        </label>
                        <div className="flex gap-2">
                          {[5, 10, 15, 20].map((score) => (
                            <Button
                              key={score}
                              variant={scoreToWin === score ? "default" : "outline"}
                              size="sm"
                              className={cn(
                                "flex-1",
                                scoreToWin === score
                                  ? ""
                                  : "border-[#dcc7a2] hover:bg-[#faefd8]",
                              )}
                              onClick={() => setScoreToWin(score)}
                            >
                              {score}
                            </Button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3 text-xs font-bold uppercase tracking-[0.2em] text-[#8d7760]">
                  <span className="h-px flex-1 bg-[#dcc7a2]" />
                  or join one
                  <span className="h-px flex-1 bg-[#dcc7a2]" />
                </div>

                <div className="flex gap-2">
                  <Input
                    value={joinGameId}
                    onChange={(e) =>
                      setJoinGameId(
                        e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""),
                      )
                    }
                    placeholder="Game ID"
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
              </CardContent>
            </Card>
          </motion.div>

          {/* Online — Matchmaking */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="break-inside-avoid"
          >
            <Card className={cn("overflow-hidden shadow-xl", paperCard)}>
              <div className="h-2 bg-[linear-gradient(90deg,#6e4f29,#d2a661)]" />
              <CardHeader className="pb-6">
                <Badge className="w-fit bg-[#f5ead8] text-[#6e5437] mb-2">
                  Online
                </Badge>
                <CardTitle className="text-3xl text-[#2b1e14]">
                  Matchmaking
                </CardTitle>
                <CardDescription className="text-sm text-[#6e5b48] mt-1 xl:hidden">
                  Jump into a game against a random opponent. Pick a time
                  control or play without one.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pb-6">
                <Button
                  size="lg"
                  className="w-full h-12 text-base"
                  onClick={() => navigate("/matchmaking")}
                >
                  Unlimited time game
                </Button>

                <div className="space-y-2">
                  <p className="text-[0.68rem] text-[#8d7760]">
                    Format: <span className="font-semibold">minutes + seconds increment per move</span>
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {TIME_CONTROL_PRESETS.map((preset) => {
                      const minutes = Math.floor(preset.timeControl.initialMs / 60_000);
                      const increment = Math.floor(preset.timeControl.incrementMs / 1_000);
                      const tooltip = `${minutes} min${minutes !== 1 ? "s" : ""} per player${increment > 0 ? ` + ${increment}s added per move` : ", no increment"}`;

                      return (
                        <Button
                          key={preset.label}
                          variant="secondary"
                          title={tooltip}
                          className="flex flex-col items-center gap-0.5 h-auto py-2.5 border-[#dcc7a2] hover:border-[#b98d49] hover:bg-[#fff8ee] transition-all"
                          onClick={() =>
                            navigate("/matchmaking", {
                              state: { timeControl: preset.timeControl },
                            })
                          }
                        >
                          <span className="text-sm font-bold text-[#2b1e14]">
                            {preset.label}
                          </span>
                          <span className="text-[0.6rem] uppercase tracking-wider text-[#8d7760]">
                            {preset.category}
                          </span>
                        </Button>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </section>

        {auth?.player?.kind === "account" && (
          <section className="grid grid-cols-1 gap-6 md:mt-8 md:grid-cols-2">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col"
            >
              <Card className={cn("overflow-hidden shadow-lg flex-1", paperCard)}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-black/5 bg-black/2 py-4">
                  <CardTitle className="text-2xl text-[#2b1e14]">
                    Active Games
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
                    const opponentSeat =
                      game.yourSeat === "white" ? "black" : "white";
                    const opponentOnline =
                      game.seats[opponentSeat]?.online ?? false;
                    const hasRematchRequest =
                      game.status === "finished" &&
                      !!game.rematch?.requestedBy.length;
                    return (
                      <div
                        key={game.gameId}
                        data-testid={`lobby-game-${game.gameId}`}
                        className={cn(
                          "flex items-center justify-between rounded-2xl border p-4 shadow-sm hover:border-[#b98d49] transition-colors group",
                          hasRematchRequest
                            ? "border-[#d4b87a] bg-[#fdf6e8]"
                            : opponentOnline
                              ? "border-[#b8cc8f] bg-[#f9fcf3]"
                              : "border-[#d7c39e] bg-[#fffaf3]",
                        )}
                      >
                        <div className="flex items-center gap-4">
                          <div className="flex flex-col">
                            <p className="font-mono text-lg font-bold text-[#2b1e14]">
                              {game.gameId}
                            </p>
                            <p className="text-sm text-[#6e5b48]">
                              vs {getOpponentLabel(game, auth.player.playerId)}
                              {opponentOnline && (
                                <span
                                  className="ml-1.5 inline-block h-2 w-2 rounded-full bg-[#6ba34a]"
                                  title="Opponent is online"
                                />
                              )}
                            </p>
                          </div>
                          <Badge
                            className={cn(
                              "ml-2 px-3 py-1",
                              hasRematchRequest
                                ? "bg-[#f5ead4] text-[#8d6a2f] animate-pulse"
                                : isYourTurn
                                  ? "bg-[#e8f2d8] text-[#4b6537] animate-pulse"
                                  : "bg-[#f3e7d5] text-[#6b563e]",
                            )}
                          >
                            {hasRematchRequest
                              ? "Rematch requested"
                              : isYourTurn
                                ? "Your move"
                                : "Their move"}
                          </Badge>
                        </div>
                        <Button
                          size="sm"
                          className="shadow-sm group-hover:scale-105 transition-transform"
                          onClick={() => navigate(`/game/${game.gameId}`)}
                        >
                          {hasRematchRequest ? "View" : "Resume"}
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
              className="flex flex-col"
            >
              <Card className={cn("overflow-hidden shadow-lg flex-1", paperCard)}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-black/5 bg-black/2 py-4">
                  <CardTitle className="text-2xl text-[#2b1e14]">
                    Invitations
                  </CardTitle>
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
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-[#dcc7a2] hover:bg-[#faefd8]"
                          onClick={() => handleDeclineGameInvitation(inv.id)}
                        >
                          Decline
                        </Button>
                        <Button
                          size="sm"
                          className="shadow-sm group-hover:scale-105 transition-transform"
                          onClick={() => navigate(`/game/${inv.gameId}`)}
                        >
                          Accept
                        </Button>
                      </div>
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

        <section className="mt-8">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mx-auto md:max-w-md"
          >
            <Card className={cn("overflow-hidden shadow-lg", paperCard)}>
              <CardHeader className="pb-3">
                <Badge className="w-fit bg-[#e8e0f4] text-[#5a4570] mb-2">
                  Spectate
                </Badge>
                <CardTitle className="text-2xl text-[#2b1e14]">
                  Watch a Game
                </CardTitle>
                <CardDescription className="text-sm text-[#6e5b48] mt-1">
                  Paste a Game ID to spectate a match in progress.
                </CardDescription>
              </CardHeader>
              <CardContent className="pb-6">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const input = e.currentTarget.elements.namedItem(
                      "spectate-id",
                    ) as HTMLInputElement;
                    const id = input?.value.trim().toUpperCase();
                    if (!id) return;
                    const allGames = [
                      ...multiplayerGames.active,
                      ...multiplayerGames.finished,
                    ];
                    if (allGames.some((g) => g.gameId === id)) {
                      toast.error(
                        "That's your own game! Use the game list above to rejoin it.",
                      );
                      return;
                    }
                    navigate(`/game/${id}`);
                  }}
                  className="flex gap-2"
                >
                  <Input
                    name="spectate-id"
                    placeholder="Game ID"
                    maxLength={6}
                    className="h-12 font-mono bg-white/60 border-[#dcc7a2] focus:ring-[#b98d49]"
                    onChange={(e) => {
                      e.target.value = e.target.value
                        .toUpperCase()
                        .replace(/[^A-Z0-9]/g, "");
                    }}
                  />
                  <Button
                    type="submit"
                    variant="outline"
                    className="h-12 px-6 border-[#dcc7a2] hover:bg-[#f5f0fc]"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>
                    Watch
                  </Button>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        </section>
      </main>
    </div>
  );
}
