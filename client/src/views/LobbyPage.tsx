"use client";
import { useState, useMemo, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { TIME_CONTROL_PRESETS } from "@shared";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PaperCard } from "@/components/ui/paper-card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Navbar } from "@/components/Navbar";
import { isSummaryYourTurn, translatePlayerColor, ColorDot } from "@/components/game/GameShared";
import { GameConfigBadge } from "@/components/game/GameConfigBadge";
import { GameConfigDialog } from "@/components/game/GameConfigDialog";
import { useGameConfig } from "@/lib/hooks/useGameConfig";
import { ActiveGameCard } from "@/components/game/ActiveGameCard";
import { PlayerIdentityRow } from "@/components/PlayerIdentityRow";
import { useGamesIndex } from "@/lib/hooks/useGamesIndex";
import { useSocialData } from "@/lib/hooks/useSocialData";
import { useTournamentList } from "@/lib/hooks/useTournamentList";
import { useLobbyMessage } from "@/lib/LobbySocketContext";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  createMultiplayerGame,
  joinMultiplayerGame,
  cancelMultiplayerGame,
  cancelRematchRequest,
} from "@/lib/api";
import { toastError } from "@/lib/errors";

function LobbySectionSkeleton() {
  return (
    <div className="flex flex-col animate-pulse">
      <PaperCard className="overflow-hidden shadow-lg flex-1">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-black/5 bg-black/2 py-4">
          <div className="h-7 w-32 rounded-lg bg-[#e8dcc8]" />
        </CardHeader>
        <CardContent className="space-y-3 pt-6">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-2xl border border-[#dcc7a2] bg-[#fffdf7] p-4"
            >
              <div className="flex flex-col gap-2">
                <div className="h-5 w-24 rounded-sm bg-[#e8dcc8]" />
                <div className="h-3.5 w-40 rounded-sm bg-[#ede3d2]" />
              </div>
              <div className="h-8 w-16 rounded-lg bg-[#e8dcc8]" />
            </div>
          ))}
        </CardContent>
      </PaperCard>
    </div>
  );
}

export function LobbyPage() {
  const { auth, authLoading, onOpenAuth, onLogout } = useAuth();
  const isGuest = auth?.player.kind === "guest";
  const router = useRouter();
  const t = useTranslations("lobby");
  const tc = useTranslations("common");
  const tConfig = useTranslations("config");
  const tGame = useTranslations("game");
  const tNav = useTranslations("nav");
  const { multiplayerGames, refreshMultiplayerGames } = useGamesIndex(auth);

  const { socialOverview, refreshSocialOverview, handleDeclineGameInvitation } = useSocialData(
    auth,
    true,
  );

  const tTournament = useTranslations("tournament");
  const { publicTournaments, myTournaments } = useTournamentList(auth);
  const lobbyTournaments = useMemo(() => {
    // Merge and deduplicate, preferring "my" entries
    const myIds = new Set(myTournaments.map((t) => t.tournamentId));
    const merged = [
      ...myTournaments,
      ...publicTournaments.filter((t) => !myIds.has(t.tournamentId)),
    ];
    // Show active/registration first, then by date
    return merged
      .filter((t) => t.status === "registration" || t.status === "active")
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 3);
  }, [publicTournaments, myTournaments]);

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

      // Rematch toasts are handled globally by SocialNotificationsContext
      // so they work on every page, not just the lobby.
    }
    if (payload.type === "social-update") {
      void refreshSocialOverview({ silent: true, allowInviteToast: true });
    }
  });

  const [navOpen, setNavOpen] = useState(false);
  const [cancellingRematchId, setCancellingRematchId] = useState<string | null>(null);
  const [joinGameId, setJoinGameId] = useState("");
  const [multiplayerBusy, setMultiplayerBusy] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const multiplayerConfig = useGameConfig("multiplayer");

  const [showLocalDialog, setShowLocalDialog] = useState(false);
  const localConfig = useGameConfig("local");

  const [showComputerDialog, setShowComputerDialog] = useState(false);
  const computerConfig = useGameConfig("computer");

  const activeGames = multiplayerGames.active ?? [];
  const finishedGames = multiplayerGames.finished ?? [];
  const rematchGames = useMemo(() => {
    return finishedGames.filter((g) => g.rematch?.requestedBy.length && g.yourSeat);
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
  const [showTutorialBanner, setShowTutorialBanner] = useState(false);

  useEffect(() => {
    const seenViaAccount = auth?.player.kind === "account" && auth.player.hasSeenTutorial;
    const seenViaLocal = localStorage.getItem("tiao:tutorialComplete");
    if (!seenViaAccount && !seenViaLocal) {
      setShowTutorialBanner(true);
    }
  }, [auth]);

  function checkGuestLimit(): boolean {
    if (auth?.player.kind === "guest" && guestGamesRemaining <= 0) {
      setGuestLimitDialogOpen(true);
      return false;
    }
    return true;
  }

  async function handleCreateRoom() {
    if (!auth || isGuest) return;
    if (!checkGuestLimit()) return;

    setMultiplayerBusy(true);
    try {
      const response = await createMultiplayerGame(multiplayerConfig.buildMultiplayerSettings());
      setShowCreateDialog(false);
      router.push(`/game/${response.snapshot.gameId}`);
    } catch (error) {
      toastError(error);
    } finally {
      setMultiplayerBusy(false);
    }
  }

  function handleStartLocal() {
    setShowLocalDialog(false);
    router.push(`/local?${localConfig.buildLocalParams()}`);
  }

  function handleStartComputer() {
    setShowComputerDialog(false);
    router.push(`/computer?${computerConfig.buildComputerParams()}`);
  }

  async function handleJoinRoom() {
    if (!auth || isGuest) return;
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

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 bg-[radial-gradient(circle_at_top,rgba(255,247,231,0.76),transparent_58%)]" />

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
        {showTutorialBanner && (
          <section className="relative flex flex-col items-center justify-center py-4 text-center sm:py-12">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-2 sm:gap-4"
            >
              <span className="flex h-16 w-16 items-center justify-center rounded-3xl border-2 border-[#f6e8cf]/55 bg-[linear-gradient(180deg,#faefd8,#ecd4a6)] font-display text-4xl text-[#25170d] shadow-[0_32px_64px_-24px_rgba(37,23,13,0.85)] sm:h-24 sm:w-24 sm:rounded-[2.5rem] sm:text-6xl">
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

        <section className="mt-6 columns-1 gap-6 md:mt-8 md:columns-2 xl:columns-none xl:grid xl:grid-cols-3 *:mb-6 xl:*:mb-0">
          {/* Local — Over the Board */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="break-inside-avoid xl:flex xl:flex-col"
          >
            <PaperCard className="overflow-hidden shadow-xl xl:flex-1">
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
                  onClick={() => setShowLocalDialog(true)}
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
                  onClick={() => setShowComputerDialog(true)}
                >
                  {t("playWithBot")}
                </Button>
              </CardContent>
            </PaperCard>
          </motion.div>

          {/* Online — Play Against Someone Specific */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="break-inside-avoid xl:flex xl:flex-col"
          >
            <PaperCard className="overflow-hidden shadow-xl xl:flex-1">
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
                {isGuest ? (
                  <div className="space-y-4">
                    <div
                      className="space-y-3 opacity-40 pointer-events-none select-none"
                      aria-hidden
                    >
                      <Button size="lg" className="w-full h-12 text-base" disabled>
                        {t("createGame")}
                      </Button>
                      <div className="flex items-center gap-3 text-xs font-bold uppercase tracking-[0.2em] text-[#8d7760]">
                        <span className="h-px flex-1 bg-[#dcc7a2]" />
                        {t("orJoinOne")}
                        <span className="h-px flex-1 bg-[#dcc7a2]" />
                      </div>
                      <div className="flex gap-2">
                        <Input
                          disabled
                          placeholder={tc("gameId")}
                          className="h-12 font-mono bg-white/60 border-[#dcc7a2]"
                        />
                        <Button variant="outline" className="h-12 px-6 border-[#dcc7a2]" disabled>
                          {tc("join")}
                        </Button>
                      </div>
                    </div>
                    <p className="text-sm text-center text-[#6e5b48]">
                      {t("customGameRequiresAccount")}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="flex-1 border-[#dcc7a2] hover:bg-[#faefd8]"
                        onClick={() => onOpenAuth("login")}
                      >
                        {tc("signIn")}
                      </Button>
                      <Button className="flex-1" onClick={() => onOpenAuth("signup")}>
                        {tc("signUp")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
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
                  </>
                )}
              </CardContent>
            </PaperCard>
          </motion.div>

          {/* Online — Matchmaking */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="break-inside-avoid"
          >
            <PaperCard className="overflow-hidden shadow-xl">
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
            </PaperCard>
          </motion.div>
        </section>

        {(auth || authLoading) && (
          <section className="grid grid-cols-1 gap-6 md:mt-8 md:grid-cols-2">
            {authLoading ? (
              <>
                <LobbySectionSkeleton />
                <LobbySectionSkeleton />
              </>
            ) : (
              <>
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col"
                >
                  <PaperCard className="overflow-hidden shadow-lg flex-1">
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
                      {sortedActiveGames.slice(0, 3).map((game) => (
                        <ActiveGameCard
                          key={game.gameId}
                          game={game}
                          data-testid={`lobby-game-${game.gameId}`}
                          onResume={() => router.push(`/game/${game.gameId}`)}
                          onDelete={async () => {
                            try {
                              await cancelMultiplayerGame(game.gameId);
                              toast.success(t("gameDeleted"));
                              void refreshMultiplayerGames({ silent: true });
                            } catch (err) {
                              toastError(err);
                            }
                          }}
                          onCancelRematch={async () => {
                            setCancellingRematchId(game.gameId);
                            try {
                              await cancelRematchRequest(game.gameId);
                              void refreshMultiplayerGames({ silent: true });
                            } catch (err) {
                              toastError(err);
                            } finally {
                              setCancellingRematchId(null);
                            }
                          }}
                          cancellingRematch={cancellingRematchId === game.gameId}
                        />
                      ))}
                      {sortedActiveGames.length === 0 && (
                        <p className="text-center text-sm text-[#6e5b48] py-8 bg-white/20 rounded-2xl border border-dashed border-[#dcc7a2]">
                          {t("noActiveGames")}
                        </p>
                      )}
                    </CardContent>
                  </PaperCard>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col"
                >
                  <PaperCard className="overflow-hidden shadow-lg flex-1">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-black/5 bg-black/2 py-4">
                      <CardTitle className="text-2xl text-[#2b1e14]">{t("invitations")}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 pt-6">
                      {socialOverview.incomingInvitations.slice(0, 3).map((inv) => (
                        <div
                          key={inv.id}
                          className="rounded-2xl border border-[#dcc7a2] bg-[#fffdf7] p-4 shadow-xs hover:border-[#b98d49] transition-colors group space-y-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <PlayerIdentityRow
                              player={inv.sender}
                              currentPlayerId={auth?.player.playerId}
                              linkToProfile={false}
                              online={inv.sender.online}
                              className="gap-3 min-w-0"
                            />
                            {inv.assignedColor && (
                              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#dcc7a3] bg-[#fff9ef] px-2 py-1 text-xs text-[#6b5a45]">
                                <ColorDot color={inv.assignedColor} className="h-3 w-3" />
                                {tc("playingAs", {
                                  color: translatePlayerColor(inv.assignedColor, tGame) ?? "",
                                })}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-[#6b5a45]">
                            <GameConfigBadge
                              boardSize={inv.boardSize}
                              scoreToWin={inv.scoreToWin}
                              timeControl={inv.timeControl}
                              roomType={inv.roomType}
                            />
                          </div>
                          <div className="flex gap-2 pt-1">
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
                              className="shadow-xs group-hover:scale-105 transition-transform"
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
                  </PaperCard>
                </motion.div>
              </>
            )}
          </section>
        )}

        <section className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="flex flex-col"
          >
            <PaperCard className="overflow-hidden shadow-lg flex-1">
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
                    router.push(`/game/${id}?spectate=true`);
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
            </PaperCard>
          </motion.div>

          {(auth || authLoading) &&
            (authLoading ? (
              <LobbySectionSkeleton />
            ) : (
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 }}
                className="flex flex-col"
              >
                <PaperCard className="overflow-hidden shadow-lg flex-1">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-black/5 bg-black/2 py-4">
                    <CardTitle className="text-2xl text-[#2b1e14]">{t("tournaments")}</CardTitle>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="bg-[#f4e8d2] hover:bg-[#ecd4a6] border-[#dcc7a2] text-[#6c543c]"
                      onClick={() => router.push("/tournaments")}
                    >
                      {t("showAll")}
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-6">
                    {lobbyTournaments.length === 0 && (
                      <p className="text-center text-sm text-[#6e5b48] py-8 bg-white/20 rounded-2xl border border-dashed border-[#dcc7a2]">
                        {t("noTournaments")}
                      </p>
                    )}
                    {lobbyTournaments.map((item) => (
                      <div
                        key={item.tournamentId}
                        className="flex items-center justify-between rounded-2xl border border-[#dcc7a2] bg-[#fffdf7] p-4 shadow-xs hover:border-[#b98d49] transition-colors group cursor-pointer"
                        onClick={() => router.push(`/tournament/${item.tournamentId}`)}
                      >
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-lg text-[#2b1e14] truncate">
                              {item.name}
                            </p>
                            <Badge
                              className={cn(
                                "shrink-0",
                                item.status === "registration"
                                  ? "border-green-400 bg-green-50 text-green-700"
                                  : "border-blue-400 bg-blue-50 text-blue-700",
                              )}
                            >
                              {tTournament(item.status)}
                            </Badge>
                          </div>
                          <p className="text-sm text-[#7a6656]">
                            {tTournament("players", {
                              count: item.playerCount,
                              max: item.maxPlayers,
                            })}
                            {" · "}
                            {tTournament("by", { name: item.creatorDisplayName })}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          className="shrink-0 shadow-xs group-hover:scale-105 transition-transform"
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/tournament/${item.tournamentId}`);
                          }}
                        >
                          {tc("view")}
                        </Button>
                      </div>
                    ))}
                  </CardContent>
                </PaperCard>
              </motion.div>
            ))}
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
        <p className="mt-2">
          <a
            href="https://github.com/trebeljahr/tiao/issues/new/choose"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium text-[#8b7356] underline decoration-[#d4c4a8] underline-offset-2 hover:text-[#5d4732]"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
              <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
            </svg>
            {tNav("reportIssue")}
          </a>
        </p>
      </footer>

      <GameConfigDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        title={t("createGameTitle")}
        description={t("createGameDesc")}
        config={multiplayerConfig}
        submitLabel={t("createGameButton")}
        onSubmit={handleCreateRoom}
        busy={multiplayerBusy}
      />

      <GameConfigDialog
        open={showLocalDialog}
        onOpenChange={setShowLocalDialog}
        title={t("localGameTitle")}
        description={t("localGameDesc")}
        config={localConfig}
        submitLabel={t("startGame")}
        onSubmit={handleStartLocal}
      />

      <GameConfigDialog
        open={showComputerDialog}
        onOpenChange={setShowComputerDialog}
        title={t("computerGameTitle")}
        description={t("computerGameDesc")}
        config={computerConfig}
        submitLabel={t("startGame")}
        onSubmit={handleStartComputer}
      />

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
