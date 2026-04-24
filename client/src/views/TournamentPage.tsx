"use client";
import { BackButton } from "@/components/BackButton";
import { Navbar } from "@/components/Navbar";
import { PlayerIdentityRow } from "@/components/PlayerIdentityRow";
import { GameConfigBadge } from "@/components/game/GameConfigBadge";
import { BracketVisualization } from "@/components/tournament/BracketVisualization";
import { MatchCard } from "@/components/tournament/MatchCard";
import { StandingsTable } from "@/components/tournament/StandingsTable";
import { AnimatedCard } from "@/components/ui/animated-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PaperCard } from "@/components/ui/paper-card";
import { SkeletonPage } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/AuthContext";
import {
  accessTournament,
  cancelTournament as apiCancelTournament,
  deleteTournament as apiDeleteTournament,
  startTournament as apiStartTournament,
  randomizeTournamentSeeding,
  registerForTournament,
  unregisterFromTournament,
} from "@/lib/api";
import { resolveDynamicParam } from "@/lib/desktopPathParam";
import { toastError } from "@/lib/errors";
import { useTournament } from "@/lib/hooks/useTournament";
import type { TournamentSnapshot } from "@shared";
import { useTranslations } from "next-intl";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export function TournamentPage() {
  const t = useTranslations("tournament");
  const tCommon = useTranslations("common");
  const { auth, onOpenAuth, onLogout } = useAuth();
  const params = useParams<{ tournamentId: string }>();
  const searchParams = useSearchParams();
  // See `resolveDynamicParam` for why this fallback exists (desktop
  // Electron serves a single `__spa__` shell HTML for /tournament/*).
  const tournamentId = resolveDynamicParam("tournament", params?.tournamentId);
  const inviteCodeFromUrl = searchParams?.get("code") ?? null;
  const router = useRouter();
  const playerId = auth?.player?.playerId;
  const isAccount = auth?.player?.kind === "account";
  const [busy, setBusy] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [inviteCodeDialogOpen, setInviteCodeDialogOpen] = useState(false);
  const [inviteCodeInput, setInviteCodeInput] = useState("");
  const accessAttempted = useRef(false);

  function formatLabel(format: string): string {
    switch (format) {
      case "round-robin":
        return t("roundRobin");
      case "single-elimination":
        return t("eliminationFull");
      case "groups-knockout":
        return t("groupsKnockout");
      default:
        return format;
    }
  }

  // The sticky "match ready" notification is now handled globally by
  // TournamentNotificationsContext — see providers.tsx. We no longer fire
  // an ephemeral sonner toast here, so the user sees the same
  // notification whether they're on the tournament page or anywhere
  // else in the app, and it survives page reloads because the provider
  // re-fetches from the server on mount.
  const { tournament, loading, error, refresh } = useTournament(auth, tournamentId ?? null);

  // Auto-access private tournament when invite code is in URL
  useEffect(() => {
    if (!inviteCodeFromUrl || !tournamentId || !isAccount || !playerId || accessAttempted.current) {
      return;
    }
    accessAttempted.current = true;
    accessTournament(tournamentId, inviteCodeFromUrl)
      .then(() => {
        refresh({ silent: true });
      })
      .catch(() => {
        // Access failed — user will see the tournament page normally
        // (or get a 404 if they don't have permission)
      });
  }, [inviteCodeFromUrl, tournamentId, isAccount, playerId, refresh]);

  if (loading && !tournament) {
    return <SkeletonPage />;
  }

  if (error || !tournament) {
    return (
      <>
        <Navbar
          auth={auth}
          navOpen={navOpen}
          onToggleNav={() => setNavOpen(!navOpen)}
          onCloseNav={() => setNavOpen(false)}
          onOpenAuth={onOpenAuth}
          onLogout={onLogout}
        />
        <div className="mx-auto max-w-4xl px-4 pb-5 pt-20 space-y-4">
          <BackButton />
          <p className="text-red-600">{error ?? t("tournamentNotFound")}</p>
        </div>
      </>
    );
  }

  const isAdmin = playerId === tournament.creatorId;
  const isRegistered = tournament.participants.some((p) => p.playerId === playerId);
  const canJoin =
    isAccount &&
    !isRegistered &&
    tournament.status === "registration" &&
    tournament.participants.length < tournament.settings.maxPlayers;
  const canStart =
    isAdmin &&
    tournament.status === "registration" &&
    tournament.participants.length >= tournament.settings.minPlayers;

  async function handleAction(action: () => Promise<any>) {
    setBusy(true);
    try {
      await action();
      refresh({ silent: true });
    } catch (err: any) {
      toastError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Find current round matches for featured section
  const activeMatches = getAllActiveMatches(tournament);

  return (
    <>
      <Navbar
        auth={auth}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen(!navOpen)}
        onCloseNav={() => setNavOpen(false)}
        onOpenAuth={onOpenAuth}
        onLogout={onLogout}
      />

      <div className="mx-auto max-w-5xl px-4 pb-5 pt-20 space-y-6">
        <div className="mb-2">
          <BackButton />
        </div>
        {/* Header */}
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="font-display text-3xl font-bold">{tournament.name}</h1>
            <Badge>{tournament.status}</Badge>
            <Badge>{formatLabel(tournament.settings.format)}</Badge>
          </div>
          {tournament.description && (
            <p className="text-sm text-muted-foreground mt-1">{tournament.description}</p>
          )}
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
            <span>
              {t("players", {
                count: tournament.participants.length,
                max: tournament.settings.maxPlayers,
              })}
            </span>
            <GameConfigBadge
              boardSize={tournament.settings.boardSize ?? 19}
              scoreToWin={tournament.settings.scoreToWin ?? 10}
              timeControl={tournament.settings.timeControl}
              showAll
            />
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          {canJoin && (
            <Button
              disabled={busy}
              onClick={() => {
                if (tournament.settings.visibility === "private") {
                  if (inviteCodeFromUrl) {
                    // Already have code from URL — use it directly
                    handleAction(() =>
                      registerForTournament(tournament.tournamentId, inviteCodeFromUrl),
                    );
                  } else {
                    setInviteCodeInput("");
                    setInviteCodeDialogOpen(true);
                  }
                } else {
                  handleAction(() => registerForTournament(tournament.tournamentId));
                }
              }}
            >
              {t("joinTournament")}
            </Button>
          )}
          {isRegistered && tournament.status === "registration" && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => handleAction(() => unregisterFromTournament(tournament.tournamentId))}
            >
              {t("leaveTournament")}
            </Button>
          )}
          {isAdmin &&
            tournament.settings.visibility === "private" &&
            tournament.settings.inviteCode && (
              <Button
                variant="outline"
                onClick={() => {
                  const url = `${window.location.origin}/tournament/${tournament.tournamentId}?code=${tournament.settings.inviteCode}`;
                  navigator.clipboard
                    .writeText(url)
                    .then(() => {
                      toast.success(t("inviteLinkCopied"));
                    })
                    .catch(() => {
                      toast.error(t("inviteLinkCopyFailed"));
                    });
                }}
              >
                {t("copyInviteLink")}
              </Button>
            )}
          {canStart && (
            <Button
              disabled={busy}
              onClick={() => handleAction(() => apiStartTournament(tournament.tournamentId))}
            >
              {t("startTournament")}
            </Button>
          )}
          {isAdmin &&
            tournament.status === "registration" &&
            tournament.participants.length >= tournament.settings.minPlayers && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  handleAction(() => randomizeTournamentSeeding(tournament.tournamentId))
                }
              >
                {t("shuffleOrder")}
              </Button>
            )}
          {isAdmin && tournament.status !== "finished" && tournament.status !== "cancelled" && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setCancelDialogOpen(true)}
              className="border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800 hover:border-red-400"
            >
              {t("cancelTournament")}
            </Button>
          )}
          {isAdmin && tournament.status === "cancelled" && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setDeleteDialogOpen(true)}
              className="border-red-300 text-red-700 hover:bg-red-50"
            >
              {t("deleteTournament")}
            </Button>
          )}
        </div>

        {/* Featured / active matches */}
        {activeMatches.length > 0 && (
          <AnimatedCard delay={0}>
            <PaperCard>
              <CardHeader>
                <CardTitle>{t("currentMatches")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {activeMatches.map((match) => (
                    <MatchCard
                      key={match.matchId}
                      match={match}
                      currentPlayerId={playerId}
                      featured={match.matchId === tournament.featuredMatchId}
                    />
                  ))}
                </div>
              </CardContent>
            </PaperCard>
          </AnimatedCard>
        )}

        {/* Registration phase: participant list */}
        {tournament.status === "registration" && (
          <AnimatedCard delay={0.05}>
            <PaperCard>
              <CardHeader>
                <CardTitle>{t("participants")}</CardTitle>
              </CardHeader>
              <CardContent>
                {tournament.participants.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("noParticipants")}</p>
                ) : (
                  <div className="space-y-1">
                    {tournament.participants
                      .sort((a, b) => a.seed - b.seed)
                      .map((p) => (
                        <div
                          key={p.playerId}
                          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                            p.playerId === playerId ? "bg-amber-50/60 font-medium" : ""
                          }`}
                        >
                          <span className="w-6 text-right text-xs text-muted-foreground">
                            #{p.seed}
                          </span>
                          <PlayerIdentityRow
                            player={p}
                            currentPlayerId={playerId}
                            avatarClassName="h-6 w-6"
                            nameClassName="text-sm"
                          />
                        </div>
                      ))}
                  </div>
                )}
              </CardContent>
            </PaperCard>
          </AnimatedCard>
        )}

        {/* Active/Finished: Bracket or Standings */}
        {(tournament.status === "active" || tournament.status === "finished") && (
          <>
            {/* Round Robin */}
            {tournament.settings.format === "round-robin" &&
              tournament.rounds.length > 0 &&
              tournament.rounds.map((round) => (
                <PaperCard key={round.roundIndex}>
                  <CardHeader>
                    <CardTitle className="text-lg">{round.label}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {round.matches.map((match) => (
                        <MatchCard key={match.matchId} match={match} currentPlayerId={playerId} />
                      ))}
                    </div>
                  </CardContent>
                </PaperCard>
              ))}

            {/* Single Elimination Bracket */}
            {tournament.settings.format === "single-elimination" &&
              tournament.rounds.length > 0 && (
                <AnimatedCard delay={0.1}>
                  <PaperCard>
                    <CardHeader>
                      <CardTitle>{t("bracket")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <BracketVisualization
                        rounds={tournament.rounds}
                        currentPlayerId={playerId}
                        featuredMatchId={tournament.featuredMatchId}
                      />
                    </CardContent>
                  </PaperCard>
                </AnimatedCard>
              )}

            {/* Groups + Knockout */}
            {tournament.settings.format === "groups-knockout" && (
              <>
                {tournament.groups.map((group) => (
                  <PaperCard key={group.groupId}>
                    <CardHeader>
                      <CardTitle>{group.label}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <StandingsTable standings={group.standings} highlightPlayerId={playerId} />
                      {group.rounds
                        .filter((r) => r.status === "active")
                        .map((round) => (
                          <div key={round.roundIndex}>
                            <h4 className="text-sm font-medium mb-2">{round.label}</h4>
                            <div className="space-y-2">
                              {round.matches.map((match) => (
                                <MatchCard
                                  key={match.matchId}
                                  match={match}
                                  currentPlayerId={playerId}
                                />
                              ))}
                            </div>
                          </div>
                        ))}
                    </CardContent>
                  </PaperCard>
                ))}
                {tournament.knockoutRounds.length > 0 && (
                  <AnimatedCard delay={0.15}>
                    <PaperCard>
                      <CardHeader>
                        <CardTitle>{t("knockoutStage")}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <BracketVisualization
                          rounds={tournament.knockoutRounds}
                          currentPlayerId={playerId}
                          featuredMatchId={tournament.featuredMatchId}
                        />
                      </CardContent>
                    </PaperCard>
                  </AnimatedCard>
                )}
              </>
            )}
          </>
        )}

        {/* Winner banner */}
        {tournament.status === "finished" &&
          (() => {
            const winner = tournament.participants.find((p) => p.status === "winner");
            return (
              <Card className="border-amber-400/60 bg-amber-50/50">
                <CardContent className="flex flex-col items-center gap-2 py-6">
                  <p className="text-sm font-semibold uppercase tracking-wider text-amber-600">
                    {t("winner")}
                  </p>
                  {winner ? (
                    <PlayerIdentityRow
                      player={winner}
                      avatarClassName="h-10 w-10"
                      nameClassName="text-xl font-bold"
                      className="gap-3"
                    />
                  ) : (
                    <p className="text-xl font-bold">{t("unknown")}</p>
                  )}
                </CardContent>
              </Card>
            );
          })()}
      </div>

      {/* Cancel confirmation dialog */}
      <Dialog
        open={cancelDialogOpen}
        onOpenChange={setCancelDialogOpen}
        title={t("cancelTournamentTitle")}
        description={t("cancelTournamentDesc")}
      >
        <div className="flex gap-3 justify-end">
          <Button variant="outline" onClick={() => setCancelDialogOpen(false)}>
            {t("keepTournament")}
          </Button>
          <Button
            className="bg-[#9b4030] text-white hover:bg-[#7a2e22]"
            disabled={busy}
            onClick={async () => {
              setCancelDialogOpen(false);
              setBusy(true);
              try {
                await apiCancelTournament(tournament.tournamentId);
                toast.success(t("tournamentCancelled"));
                router.push("/tournaments");
              } catch (err: any) {
                toastError(err.message ?? t("failedToCancel"));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("cancelTournament")}
          </Button>
        </div>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={t("deleteTournamentTitle")}
        description={t("deleteTournamentDesc")}
      >
        <div className="flex gap-3 justify-end">
          <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
            {tCommon("cancel")}
          </Button>
          <Button
            className="bg-[#9b4030] text-white hover:bg-[#7a2e22]"
            disabled={busy}
            onClick={async () => {
              setDeleteDialogOpen(false);
              setBusy(true);
              try {
                await apiDeleteTournament(tournament.tournamentId);
                toast.success(t("tournamentDeleted"));
                router.push("/tournaments");
              } catch (err: any) {
                toastError(err.message ?? t("failedToDelete"));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("deleteTournament")}
          </Button>
        </div>
      </Dialog>

      {/* Invite code dialog for private tournaments */}
      <Dialog
        open={inviteCodeDialogOpen}
        onOpenChange={setInviteCodeDialogOpen}
        title={t("enterInviteCode")}
        description={t("enterInviteCodeDesc")}
      >
        <div className="space-y-4">
          <Input
            value={inviteCodeInput}
            onChange={(e) => setInviteCodeInput(e.target.value)}
            placeholder={t("inviteCode")}
            autoFocus
          />
          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={() => setInviteCodeDialogOpen(false)}>
              {tCommon("cancel")}
            </Button>
            <Button
              disabled={!inviteCodeInput.trim() || busy}
              onClick={async () => {
                setInviteCodeDialogOpen(false);
                handleAction(() =>
                  registerForTournament(tournament.tournamentId, inviteCodeInput.trim()),
                );
              }}
            >
              {tCommon("join")}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

function getAllActiveMatches(tournament: TournamentSnapshot) {
  const matches: TournamentSnapshot["rounds"][number]["matches"] = [];

  for (const round of [...tournament.rounds, ...tournament.knockoutRounds]) {
    for (const match of round.matches) {
      if (match.status === "active") matches.push(match);
    }
  }
  for (const group of tournament.groups) {
    for (const round of group.rounds) {
      for (const match of round.matches) {
        if (match.status === "active") matches.push(match);
      }
    }
  }

  return matches;
}
