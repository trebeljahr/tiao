import { useCallback, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import type { TournamentSnapshot } from "@shared";
import { useAuth } from "@/lib/AuthContext";
import { Navbar } from "@/components/Navbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { BracketVisualization } from "@/components/tournament/BracketVisualization";
import { StandingsTable } from "@/components/tournament/StandingsTable";
import { MatchCard } from "@/components/tournament/MatchCard";
import { useTournament } from "@/lib/hooks/useTournament";
import {
  registerForTournament,
  unregisterFromTournament,
  startTournament as apiStartTournament,
  cancelTournament as apiCancelTournament,
  randomizeTournamentSeeding,
} from "@/lib/api";
import { PlayerIdentityRow } from "@/components/PlayerIdentityRow";
import { toastError } from "@/lib/errors";
import { toast } from "sonner";

function formatLabel(format: string): string {
  switch (format) {
    case "round-robin":
      return "Round Robin";
    case "single-elimination":
      return "Single Elimination";
    case "groups-knockout":
      return "Groups + Knockout";
    default:
      return format;
  }
}

export function TournamentPage() {
  const { auth, onOpenAuth, onLogout } = useAuth();
  const params = useParams<{ tournamentId: string }>();
  const tournamentId = params?.tournamentId;
  const router = useRouter();
  const playerId = auth?.player?.playerId;
  const isAccount = auth?.player?.kind === "account";
  const [busy, setBusy] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [inviteCodeDialogOpen, setInviteCodeDialogOpen] = useState(false);
  const [inviteCodeInput, setInviteCodeInput] = useState("");

  const onMatchReady = useCallback(
    (_matchId: string, roomId: string) => {
      toast("Your tournament match is ready!", {
        action: {
          label: "Play",
          onClick: () => router.push(`/game/${roomId}`),
        },
      });
    },
    [router]
  );

  const { tournament, loading, error, refresh } = useTournament(
    auth,
    tournamentId ?? null,
    { onMatchReady }
  );

  if (loading && !tournament) {
    return (
      <>
        <Navbar mode="lobby" auth={auth} navOpen={navOpen} onToggleNav={() => setNavOpen(!navOpen)} onCloseNav={() => setNavOpen(false)} onOpenAuth={onOpenAuth} onLogout={onLogout} />
        <div className="mx-auto max-w-4xl px-4 pb-5 pt-20">
          <p className="text-muted-foreground">Loading tournament...</p>
        </div>
      </>
    );
  }

  if (error || !tournament) {
    return (
      <>
        <Navbar mode="lobby" auth={auth} navOpen={navOpen} onToggleNav={() => setNavOpen(!navOpen)} onCloseNav={() => setNavOpen(false)} onOpenAuth={onOpenAuth} onLogout={onLogout} />
        <div className="mx-auto max-w-4xl px-4 pb-5 pt-20">
          <p className="text-red-600">{error ?? "Tournament not found."}</p>
        </div>
      </>
    );
  }

  const isAdmin = playerId === tournament.creatorId;
  const isRegistered = tournament.participants.some(
    (p) => p.playerId === playerId
  );
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
      <Navbar mode="lobby" auth={auth} navOpen={navOpen} onToggleNav={() => setNavOpen(!navOpen)} onCloseNav={() => setNavOpen(false)} onOpenAuth={onOpenAuth} onLogout={onLogout} />

      <div className="mx-auto max-w-5xl px-4 pb-5 pt-20 space-y-6">
        {/* Header */}
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="font-display text-3xl font-bold">{tournament.name}</h1>
            <Badge>{tournament.status}</Badge>
            <Badge>{formatLabel(tournament.settings.format)}</Badge>
          </div>
          {tournament.description && (
            <p className="text-sm text-muted-foreground mt-1">
              {tournament.description}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            {tournament.participants.length}/{tournament.settings.maxPlayers} players
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          {canJoin && (
            <Button
              disabled={busy}
              onClick={() => {
                if (tournament.settings.visibility === "private") {
                  setInviteCodeInput("");
                  setInviteCodeDialogOpen(true);
                } else {
                  handleAction(() =>
                    registerForTournament(tournament.tournamentId)
                  );
                }
              }}
            >
              Join Tournament
            </Button>
          )}
          {isRegistered && tournament.status === "registration" && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                handleAction(() =>
                  unregisterFromTournament(tournament.tournamentId)
                )
              }
            >
              Leave
            </Button>
          )}
          {canStart && (
            <Button
              disabled={busy}
              onClick={() =>
                handleAction(() =>
                  apiStartTournament(tournament.tournamentId)
                )
              }
            >
              Start Tournament
            </Button>
          )}
          {isAdmin && tournament.status === "registration" && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                handleAction(() =>
                  randomizeTournamentSeeding(tournament.tournamentId)
                )
              }
            >
              Randomize Seeds
            </Button>
          )}
          {isAdmin &&
            tournament.status !== "finished" &&
            tournament.status !== "cancelled" && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setCancelDialogOpen(true)}
              >
                Cancel Tournament
              </Button>
            )}
        </div>

        {/* Featured / active matches */}
        {activeMatches.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Current Matches</CardTitle>
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
          </Card>
        )}

        {/* Registration phase: participant list */}
        {tournament.status === "registration" && (
          <Card>
            <CardHeader>
              <CardTitle>Participants</CardTitle>
            </CardHeader>
            <CardContent>
              {tournament.participants.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No participants yet. Be the first to join!
                </p>
              ) : (
                <div className="space-y-1">
                  {tournament.participants
                    .sort((a, b) => a.seed - b.seed)
                    .map((p) => (
                      <div
                        key={p.playerId}
                        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                          p.playerId === playerId
                            ? "bg-amber-50/60 font-medium"
                            : ""
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
          </Card>
        )}

        {/* Active/Finished: Bracket or Standings */}
        {(tournament.status === "active" || tournament.status === "finished") && (
          <>
            {/* Round Robin */}
            {tournament.settings.format === "round-robin" &&
              tournament.rounds.length > 0 &&
              tournament.rounds.map((round) => (
                <Card key={round.roundIndex}>
                  <CardHeader>
                    <CardTitle className="text-lg">{round.label}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {round.matches.map((match) => (
                        <MatchCard
                          key={match.matchId}
                          match={match}
                          currentPlayerId={playerId}
                        />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}

            {/* Single Elimination Bracket */}
            {tournament.settings.format === "single-elimination" &&
              tournament.rounds.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Bracket</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <BracketVisualization
                      rounds={tournament.rounds}
                      currentPlayerId={playerId}
                      featuredMatchId={tournament.featuredMatchId}
                    />
                  </CardContent>
                </Card>
              )}

            {/* Groups + Knockout */}
            {tournament.settings.format === "groups-knockout" && (
              <>
                {tournament.groups.map((group) => (
                  <Card key={group.groupId}>
                    <CardHeader>
                      <CardTitle>{group.label}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <StandingsTable
                        standings={group.standings}
                        highlightPlayerId={playerId}
                      />
                      {group.rounds
                        .filter((r) => r.status === "active")
                        .map((round) => (
                          <div key={round.roundIndex}>
                            <h4 className="text-sm font-medium mb-2">
                              {round.label}
                            </h4>
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
                  </Card>
                ))}
                {tournament.knockoutRounds.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Knockout Stage</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <BracketVisualization
                        rounds={tournament.knockoutRounds}
                        currentPlayerId={playerId}
                        featuredMatchId={tournament.featuredMatchId}
                      />
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </>
        )}

        {/* Winner banner */}
        {tournament.status === "finished" && (() => {
          const winner = tournament.participants.find((p) => p.status === "winner");
          return (
            <Card className="border-amber-400/60 bg-amber-50/50">
              <CardContent className="flex flex-col items-center gap-2 py-6">
                <p className="text-sm font-semibold uppercase tracking-wider text-amber-600">
                  Winner
                </p>
                {winner ? (
                  <PlayerIdentityRow
                    player={winner}
                    avatarClassName="h-10 w-10"
                    nameClassName="text-xl font-bold"
                    className="gap-3"
                  />
                ) : (
                  <p className="text-xl font-bold">Unknown</p>
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
        title="Cancel Tournament"
        description="Are you sure you want to cancel this tournament? This cannot be undone."
      >
        <div className="flex gap-3 justify-end">
          <Button variant="outline" onClick={() => setCancelDialogOpen(false)}>
            Keep Tournament
          </Button>
          <Button
            className="bg-[#9b4030] text-white hover:bg-[#7a2e22]"
            disabled={busy}
            onClick={async () => {
              setCancelDialogOpen(false);
              setBusy(true);
              try {
                await apiCancelTournament(tournament.tournamentId);
                toast.success("Tournament cancelled.");
                router.push("/tournaments");
              } catch (err: any) {
                toastError(err.message ?? "Failed to cancel tournament.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Cancel Tournament
          </Button>
        </div>
      </Dialog>

      {/* Invite code dialog for private tournaments */}
      <Dialog
        open={inviteCodeDialogOpen}
        onOpenChange={setInviteCodeDialogOpen}
        title="Enter Invite Code"
        description="This is a private tournament. Enter the invite code to join."
      >
        <div className="space-y-4">
          <Input
            value={inviteCodeInput}
            onChange={(e) => setInviteCodeInput(e.target.value)}
            placeholder="Invite code"
            autoFocus
          />
          <div className="flex gap-3 justify-end">
            <Button
              variant="outline"
              onClick={() => setInviteCodeDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={!inviteCodeInput.trim() || busy}
              onClick={async () => {
                setInviteCodeDialogOpen(false);
                handleAction(() =>
                  registerForTournament(
                    tournament.tournamentId,
                    inviteCodeInput.trim()
                  )
                );
              }}
            >
              Join
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
