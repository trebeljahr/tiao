import React, { useState, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { TimeControl } from "@shared";
import { TIME_CONTROL_PRESETS } from "@shared";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Navbar } from "@/components/Navbar";
import { getOpponentLabel, isSummaryYourTurn } from "@/components/game/GameShared";
import { GameConfigPanel } from "@/components/game/GameConfigPanel";
import { GameConfigBadge } from "@/components/game/GameConfigBadge";
import { useGamesIndex } from "@/lib/hooks/useGamesIndex";
import { useSocialData } from "@/lib/hooks/useSocialData";
import { useLobbyMessage } from "@/lib/LobbySocketContext";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createMultiplayerGame, joinMultiplayerGame, cancelMultiplayerGame } from "@/lib/api";
import { toastError } from "@/lib/errors";

export function LobbyPage() {
  const { auth, onOpenAuth, onLogout } = useAuth();
  const router = useRouter();
  const t = useTranslations("lobby");
  const tc = useTranslations("common");
  const tConfig = useTranslations("config");
  const tGame = useTranslations("game");
  const { multiplayerGames, refreshMultiplayerGames } = useGamesIndex(auth);

  const { socialOverview, refreshSocialOverview, handleDeclineGameInvitation } = useSocialData(
    auth,
    true,
  );

  // Track the last seen history length per game to avoid spurious "your move" toasts
  // (e.g. when leaving a game, the departure triggers a game-update but no new move).
  const seenHistoryRef = useRef<Record<string, number>>({});

  // Real-time updates for lobby
  useLobbyMessage((payload) => {
    if (payload.type === "game-update") {
      void refreshMultiplayerGames({ silent: true });

      const summary = payload.summary as any;
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
        const opponentName = summary.seats[opponentSeat]?.player.displayName || "your opponent";
        toast.info(t("yourMoveToast", { gameId: summary.gameId }), {
          id: `your-turn-${summary.gameId}`,
          description: t("yourTurnDesc", { opponent: opponentName }),
          action: {
            label: t("joinGame"),
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
        const opponentName = summary.seats[opponentSeat]?.player.displayName || "your opponent";
        toast(t("rematchToast", { opponent: opponentName }), {
          id: `rematch-${summary.gameId}`,
          description: t("game", { gameId: summary.gameId }),
          action: {
            label: t("viewGame"),
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
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createBoardSize, setCreateBoardSize] = useState(19);
  const [createScoreToWin, setCreateScoreToWin] = useState(10);
  const [createTimeControl, setCreateTimeControl] = useState<TimeControl>(null);

  const activeGames = multiplayerGames.active ?? [];
  const finishedGames = multiplayerGames.finished ?? [];
  const rematchGames = useMemo(() => {
    return finishedGames.filter(
      (g) =>
        g.rematch?.requestedBy.length && g.yourSeat && !g.rematch.requestedBy.includes(g.yourSeat),
    );
  }, [finishedGames]);
  const sortedActiveGames = useMemo(() => {
    const combined = [...activeGames, ...rematchGames];
    return combined.sort((a, b) => {
      // Rematch requests at the top
      const aRematch = a.status === "finished" && !!a.rematch?.requestedBy.length;
      const bRematch = b.status === "finished" && !!b.rematch?.requestedBy.length;
      if (aRematch && !bRematch) return -1;
      if (!aRematch && bRematch) return 1;
      const aYourTurn = isSummaryYourTurn(a);
      const bYourTurn = isSummaryYourTurn(b);
      if (aYourTurn && !bYourTurn) return -1;
      if (!aYourTurn && bYourTurn) return 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [activeGames, rematchGames]);

  const GUEST_GAME_LIMIT = 10;
  const guestGameCount = multiplayerGames.active.length + multiplayerGames.finished.length;
  const guestGamesRemaining = GUEST_GAME_LIMIT - guestGameCount;
  const [guestLimitDialogOpen, setGuestLimitDialogOpen] = useState(false);

  function checkGuestLimit(): boolean {
    if (auth?.player.kind === "guest" && guestGamesRemaining <= 0) {
      setGuestLimitDialogOpen(true);
      return false;
    }
    return true;
  }

  async function handleCreateRoom() {
    if (!auth) {
      onOpenAuth("login");
      return;
    }
    if (!checkGuestLimit()) return;

    setMultiplayerBusy(true);
    try {
      const settings: Parameters<typeof createMultiplayerGame>[0] = {};
      if (createBoardSize !== 19) settings.boardSize = createBoardSize;
      if (createScoreToWin !== 10) settings.scoreToWin = createScoreToWin;
      if (createTimeControl) settings.timeControl = createTimeControl;
      const response = await createMultiplayerGame(
        Object.keys(settings).length > 0 ? settings : undefined,
      );
      setShowCreateDialog(false);
      router.push(`/game/${response.snapshot.gameId}`);
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
    if (!checkGuestLimit()) return;

    if (!joinGameId.trim()) {
      return;
    }

    setMultiplayerBusy(true);
    try {
      const response = await joinMultiplayerGame(joinGameId.trim().toUpperCase());
      router.push(`/game/${response.snapshot.gameId}`);
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
                {t("tagline")}
              </p>
              <Button
                variant="ghost"
                className="text-[#b98d49] hover:text-[#8d6a2f] hover:bg-[#f4e8d2] font-semibold"
                onClick={() => router.push("/tutorial")}
              >
                {t("learnToPlay")}
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
                <Badge className="w-fit bg-[#f4e8d2] text-[#6c543c] mb-2">{t("local")}</Badge>
                <CardTitle className="text-3xl text-[#2b1e14]">{t("overTheBoard")}</CardTitle>
                <CardDescription className="text-sm text-[#6e5b48] mt-1 md:hidden xl:block">
                  {t("overTheBoardDesc")}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-6 pb-6">
                <Button
                  size="lg"
                  className="w-full h-12 text-base"
                  onClick={() => router.push("/local")}
                >
                  {t("playWithFriend")}
                </Button>

                <div className="flex items-center gap-3 text-xs font-bold uppercase tracking-[0.2em] text-[#8d7760]">
                  <span className="h-px flex-1 bg-[#dcc7a2]" />
                  {tc("or")}
                  <span className="h-px flex-1 bg-[#dcc7a2]" />
                </div>

                <Button
                  size="lg"
                  variant="secondary"
                  className="w-full h-12 text-base border-[#dcc7a2]"
                  onClick={() => router.push("/computer")}
                >
                  {t("playWithBot")}
                </Button>
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
                <Badge className="w-fit bg-[#f5ead8] text-[#6e5437] mb-2">{t("online")}</Badge>
                <CardTitle className="text-3xl text-[#2b1e14]">
                  {t("playSomeoneSpecific")}
                </CardTitle>
                <CardDescription className="text-sm text-[#6e5b48] mt-1 md:hidden xl:block">
                  {t("playSomeoneSpecificDesc")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 pb-6">
                <div className="space-y-3">
                  <Button
                    size="lg"
                    className="w-full h-12 text-base"
                    onClick={() => setShowCreateDialog(true)}
                    disabled={multiplayerBusy}
                  >
                    {t("createGame")}
                  </Button>
                </div>

                <div className="flex items-center gap-3 text-xs font-bold uppercase tracking-[0.2em] text-[#8d7760]">
                  <span className="h-px flex-1 bg-[#dcc7a2]" />
                  {t("orJoinOne")}
                  <span className="h-px flex-1 bg-[#dcc7a2]" />
                </div>

                <div className="flex gap-2">
                  <Input
                    value={joinGameId}
                    onChange={(e) =>
                      setJoinGameId(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
                    }
                    placeholder={tc("gameId")}
                    maxLength={6}
                    className="h-12 font-mono bg-white/60 border-[#dcc7a2] focus:ring-[#b98d49]"
                  />
                  <Button
                    variant="outline"
                    className="h-12 px-6 border-[#dcc7a2] hover:bg-[#faefd8]"
                    onClick={handleJoinRoom}
                    disabled={multiplayerBusy || !joinGameId}
                  >
                    {tc("join")}
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
                <Badge className="w-fit bg-[#f5ead8] text-[#6e5437] mb-2">{t("online")}</Badge>
                <CardTitle className="text-3xl text-[#2b1e14]">{t("matchmaking")}</CardTitle>
                <CardDescription className="text-sm text-[#6e5b48] mt-1 xl:hidden">
                  {t("matchmakingDesc")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pb-6">
                <Button
                  size="lg"
                  className="w-full h-12 text-base"
                  onClick={() => router.push("/matchmaking")}
                >
                  {t("unlimitedTimeGame")}
                </Button>

                <div className="space-y-2">
                  <p className="text-[0.68rem] text-[#8d7760]">
                    {t("timeFormat", { format: "" })}
                    <span className="font-semibold">{t("timeFormatBold")}</span>
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {TIME_CONTROL_PRESETS.map((preset) => {
                      const minutes = Math.floor(preset.initialMs / 60_000);
                      const increment = Math.floor(preset.incrementMs / 1_000);
                      const tooltip =
                        increment > 0
                          ? t("timeControlTooltip", { minutes, increment })
                          : t("timeControlTooltipNoIncrement", { minutes });

                      return (
                        <Button
                          key={preset.label}
                          variant="secondary"
                          title={tooltip}
                          className="flex flex-col items-center gap-0.5 h-auto py-2.5 border-[#dcc7a2] hover:border-[#b98d49] hover:bg-[#fff8ee] transition-all"
                          onClick={() =>
                            router.push(
                              `/matchmaking?initial=${preset.initialMs}&increment=${preset.incrementMs}`,
                            )
                          }
                        >
                          <span className="text-sm font-bold text-[#2b1e14]">{preset.label}</span>
                          <span className="text-[0.6rem] uppercase tracking-wider text-[#8d7760]">
                            {tConfig(
                              preset.category.toLowerCase() as
                                | "bullet"
                                | "blitz"
                                | "rapid"
                                | "classical",
                            )}
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

        {auth && sortedActiveGames.length > 0 && (
          <section className="grid grid-cols-1 gap-6 md:mt-8 md:grid-cols-2">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col"
            >
              <Card className={cn("overflow-hidden shadow-lg flex-1", paperCard)}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-black/5 bg-black/2 py-4">
                  <CardTitle className="text-2xl text-[#2b1e14]">{t("activeGames")}</CardTitle>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="bg-[#f4e8d2] hover:bg-[#ecd4a6] border-[#dcc7a2] text-[#6c543c]"
                    onClick={() => router.push("/games")}
                  >
                    {t("viewAll")}
                  </Button>
                </CardHeader>
                <CardContent className="space-y-3 pt-6">
                  {sortedActiveGames.slice(0, 3).map((game) => {
                    const isYourTurn = isSummaryYourTurn(game);
                    const opponentSeat = game.yourSeat === "white" ? "black" : "white";
                    const opponentOnline = game.seats[opponentSeat]?.online ?? false;
                    const hasRematchRequest =
                      game.status === "finished" && !!game.rematch?.requestedBy.length;
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
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-2">
                              {game.yourSeat && (
                                <span
                                  className={cn(
                                    "inline-block h-3 w-3 shrink-0 rounded-full border",
                                    game.yourSeat === "white"
                                      ? "border-[#ddd2bf] bg-[radial-gradient(circle_at_30%_28%,#fffdfa,#f4eee3_58%,#d9ccb8)]"
                                      : "border-[#191410] bg-[radial-gradient(circle_at_30%_28%,#5d554f,#2d2622_58%,#0f0c0b)]",
                                  )}
                                  title={tc("playingAs", { color: game.yourSeat })}
                                />
                              )}
                              <p className="font-mono text-lg font-bold text-[#2b1e14]">
                                {game.gameId}
                              </p>
                            </div>
                            <p className="text-sm text-[#6e5b48]">
                              vs {getOpponentLabel(game, auth.player.playerId, tGame)}
                              {opponentOnline && (
                                <span
                                  className="ml-1.5 inline-block h-2 w-2 rounded-full bg-[#6ba34a]"
                                  title={t("opponentOnline")}
                                />
                              )}
                              <span className="ml-2 text-xs text-[#8d7760]">
                                {game.score.white}-{game.score.black} ·{" "}
                                {tc("moves", { count: game.historyLength })}
                              </span>
                              <GameConfigBadge
                                boardSize={game.boardSize}
                                scoreToWin={game.scoreToWin}
                                timeControl={game.timeControl}
                                roomType={game.roomType}
                                compact
                              />
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
                              ? t("rematchRequested")
                              : isYourTurn
                                ? t("yourMove")
                                : t("theirMove")}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          {game.status === "waiting" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-xs text-[#9a8770] hover:text-[#7a3328]"
                              onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                  await cancelMultiplayerGame(game.gameId);
                                  toast.success(t("gameCancelled"));
                                  void refreshMultiplayerGames({ silent: true });
                                } catch (err) {
                                  toastError(err);
                                }
                              }}
                            >
                              {tc("cancel")}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            className="shadow-sm group-hover:scale-105 transition-transform"
                            onClick={() => router.push(`/game/${game.gameId}`)}
                          >
                            {hasRematchRequest ? tc("view") : tc("resume")}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                  {sortedActiveGames.length === 0 && (
                    <p className="text-center text-sm text-[#6e5b48] py-8 bg-white/20 rounded-2xl border border-dashed border-[#dcc7a2]">
                      {t("noActiveGames")}
                    </p>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {auth?.player?.kind === "account" && (
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col"
              >
                <Card className={cn("overflow-hidden shadow-lg flex-1", paperCard)}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-black/5 bg-black/2 py-4">
                    <CardTitle className="text-2xl text-[#2b1e14]">{t("invitations")}</CardTitle>
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
                            <p className="text-sm text-[#7a6656]">Game {inv.gameId}</p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-[#dcc7a2] hover:bg-[#faefd8]"
                            onClick={() => handleDeclineGameInvitation(inv.id)}
                          >
                            {tc("decline")}
                          </Button>
                          <Button
                            size="sm"
                            className="shadow-sm group-hover:scale-105 transition-transform"
                            onClick={() => router.push(`/game/${inv.gameId}`)}
                          >
                            {tc("accept")}
                          </Button>
                        </div>
                      </div>
                    ))}
                    {socialOverview.incomingInvitations.length === 0 && (
                      <p className="text-center text-sm text-[#6e5b48] py-8 bg-white/20 rounded-2xl border border-dashed border-[#dcc7a2]">
                        {t("noInvitations")}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            )}
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
                <Badge className="w-fit bg-[#e8e0f4] text-[#5a4570] mb-2">{t("spectate")}</Badge>
                <CardTitle className="text-2xl text-[#2b1e14]">{t("watchGame")}</CardTitle>
                <CardDescription className="text-sm text-[#6e5b48] mt-1">
                  {t("watchGameDesc")}
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
                    const allGames = [...multiplayerGames.active, ...multiplayerGames.finished];
                    if (allGames.some((g) => g.gameId === id)) {
                      toast.error(t("ownGameError"));
                      return;
                    }
                    router.push(`/game/${id}`);
                  }}
                  className="flex gap-2"
                >
                  <Input
                    name="spectate-id"
                    placeholder={tc("gameId")}
                    maxLength={6}
                    className="h-12 font-mono bg-white/60 border-[#dcc7a2] focus:ring-[#b98d49]"
                    onChange={(e) => {
                      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
                    }}
                  />
                  <Button
                    type="submit"
                    variant="outline"
                    className="h-12 px-6 border-[#dcc7a2] hover:bg-[#f5f0fc]"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="mr-1.5"
                    >
                      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                    {t("watch")}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        </section>
      </main>

      <footer className="mx-auto max-w-5xl px-4 pb-8 pt-4 text-center text-xs text-[#a8957e] sm:px-6">
        <p>
          {t("footer")}{" "}
          <button
            type="button"
            className="font-medium text-[#8b7356] underline decoration-[#d4c4a8] underline-offset-2 hover:text-[#5d4732]"
            onClick={() => router.push("/creators/andreas")}
          >
            Andreas Edmeier
          </button>
          . {t("footerBuiltWith")}{" "}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="#e8839b"
            className="inline-block h-3.5 w-3.5 align-[-0.15em]"
            style={{ animation: "heartbeat 2s ease-in-out infinite" }}
          >
            <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z" />
          </svg>{" "}
          {t("footerBy")}{" "}
          <button
            type="button"
            className="font-medium text-[#8b7356] underline decoration-[#d4c4a8] underline-offset-2 hover:text-[#5d4732]"
            onClick={() => router.push("/creators/rico")}
          >
            Rico Trebeljahr
          </button>
          .
        </p>
      </footer>

      <Dialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        title={t("createGameTitle")}
        description={t("createGameDesc")}
      >
        <GameConfigPanel
          mode="multiplayer"
          boardSize={createBoardSize}
          onBoardSizeChange={setCreateBoardSize}
          scoreToWin={createScoreToWin}
          onScoreToWinChange={setCreateScoreToWin}
          timeControl={createTimeControl}
          onTimeControlChange={setCreateTimeControl}
          submitLabel={t("createGameButton")}
          onSubmit={handleCreateRoom}
          busy={multiplayerBusy}
        />
      </Dialog>

      {/* Guest game limit dialog */}
      <Dialog
        open={guestLimitDialogOpen}
        onOpenChange={setGuestLimitDialogOpen}
        title={t("guestLimitTitle")}
        description={t("guestLimitDesc", { limit: GUEST_GAME_LIMIT })}
      >
        <div className="grid gap-2">
          <Button
            onClick={() => {
              setGuestLimitDialogOpen(false);
              onOpenAuth("signup");
            }}
          >
            {tc("signUp")}
          </Button>
          <Button variant="ghost" onClick={() => setGuestLimitDialogOpen(false)}>
            {tc("cancel")}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
