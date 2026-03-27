import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { AuthResponse, MultiplayerGameSummary } from "@shared";
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
  formatFinishReason,
  getPlayerResult,
  PlayerOverviewAvatar,
  EmptySeatAvatar,
  RoomCodeCopyPill,
  formatPlayerColor,
} from "@/components/game/GameShared";
import { useGamesIndex } from "@/lib/hooks/useGamesIndex";
import { useLobbyMessage } from "@/lib/LobbySocketContext";
import { cn } from "@/lib/utils";

type GamesPageProps = {
  auth: AuthResponse | null;
  onOpenAuth: (mode: "login" | "signup") => void;
  onLogout: () => void;
};

function PlayerLabel({
  player,
  isYou,
  color,
}: {
  player: { displayName?: string; profilePicture?: string } | null;
  isYou: boolean;
  color: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {player ? (
        <PlayerOverviewAvatar player={player} className="h-5 w-5" />
      ) : (
        <EmptySeatAvatar className="h-5 w-5" />
      )}
      <span className="truncate text-sm font-medium text-[#2b1e14]">
        {player?.displayName ?? "Unknown"}
        {isYou && <span className="text-[#6e5b48]"> (you)</span>}
      </span>
      <span className="text-xs text-[#9a8770]">({color})</span>
    </span>
  );
}

function MatchVsHeader({
  game,
  playerId,
}: {
  game: MultiplayerGameSummary;
  playerId: string;
}) {
  const whitePlayer = game.seats.white?.player ?? null;
  const blackPlayer = game.seats.black?.player ?? null;
  const isWhiteYou = whitePlayer?.playerId === playerId;
  const isBlackYou = blackPlayer?.playerId === playerId;

  return (
    <div className="flex flex-col gap-0.5">
      <PlayerLabel player={whitePlayer} isYou={isWhiteYou} color="white" />
      <span className="pl-6 text-[10px] font-bold uppercase tracking-wider text-[#b5a48e]">vs</span>
      <PlayerLabel player={blackPlayer} isYou={isBlackYou} color="black" />
    </div>
  );
}

export function GamesPage({ auth, onOpenAuth, onLogout }: GamesPageProps) {
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const {
    multiplayerGames,
    refreshMultiplayerGames,
  } = useGamesIndex(auth);

  // Real-time updates for games page
  useLobbyMessage((payload) => {
    if (payload.type === "game-update") {
      void refreshMultiplayerGames({ silent: true });
    }
  });

  const handleCopy = useCallback((gameId: string) => {
    void navigator.clipboard.writeText(gameId);
    setCopiedId(gameId);
    setTimeout(() => setCopiedId((prev) => (prev === gameId ? null : prev)), 1800);
  }, []);

  const paperCard =
    "border-[#d0bb94]/75 bg-[linear-gradient(180deg,rgba(255,250,242,0.96),rgba(244,231,207,0.94))]";

  useEffect(() => {
    if (!auth || auth.player.kind !== "account") {
      navigate("/", { replace: true });
    }
  }, [auth, navigate]);

  if (!auth || auth.player.kind !== "account") {
    return null;
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
        onOpenAuth={onOpenAuth}
        onLogout={onLogout}
      />

      <main className="mx-auto flex max-w-5xl flex-col gap-5 px-4 pb-5 pt-20 sm:px-6 lg:px-8 lg:pb-6 lg:pt-20">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-display font-bold text-[#2b1e14]">My Games</h1>
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
                const opponent = game.yourSeat === "white"
                  ? game.seats.black?.player
                  : game.seats.white?.player;
                return (
                  <div key={game.gameId} className="flex items-center justify-between gap-3 p-4 rounded-2xl border border-[#d7c39e] bg-white/40">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {opponent ? (
                          <PlayerOverviewAvatar player={opponent} className="h-6 w-6 shrink-0" />
                        ) : (
                          <EmptySeatAvatar className="h-6 w-6 shrink-0" />
                        )}
                        <p className="truncate text-sm font-semibold text-[#2b1e14]">
                          {getOpponentLabel(game, auth.player.playerId)}
                        </p>
                      </div>
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
            <CardContent className="grid gap-3">
              {multiplayerGames.finished.map(game => {
                const result = getPlayerResult(game);
                const reason = formatFinishReason(game.finishReason);
                return (
                  <div key={game.gameId} className="flex items-center justify-between gap-3 p-4 rounded-2xl border border-[#d7c39e] bg-white/40">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-center gap-3 flex-wrap">
                        <MatchVsHeader game={game} playerId={auth.player.playerId} />
                        <RoomCodeCopyPill
                          gameId={game.gameId}
                          copied={copiedId === game.gameId}
                          onCopy={() => handleCopy(game.gameId)}
                        />
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {result && (
                          <Badge className={cn(
                            "text-xs font-semibold",
                            result === "won"
                              ? "bg-[#4b8b2a] text-white"
                              : "bg-[#f8ddd8] text-[#7a3328]",
                          )}>
                            {result === "won" ? `Won as ${game.yourSeat}` : `Lost as ${game.yourSeat}`}
                          </Badge>
                        )}
                        {!result && game.winner && (
                          <Badge className="bg-[#f3e7d5] text-[#6b563e] text-xs font-semibold">
                            {formatPlayerColor(game.winner)} won
                          </Badge>
                        )}
                        {reason && (
                          <Badge className="bg-[#f3e7d5] text-[#6b563e] text-xs">
                            {reason}
                          </Badge>
                        )}
                        <span className="text-xs text-[#9a8770]">
                          {formatGameTimestamp(game.updatedAt)}
                        </span>
                      </div>
                    </div>
                    <Button variant="outline" className="shrink-0" onClick={() => navigate(`/game/${game.gameId}`)}>Review</Button>
                  </div>
                );
              })}
              {multiplayerGames.finished.length === 0 && <p className="col-span-full py-8 text-center text-sm text-[#6e5b48]">No completed matches yet.</p>}
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}
