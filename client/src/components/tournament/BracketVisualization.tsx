import type { TournamentRound } from "@shared";
import { MatchCard } from "./MatchCard";

export function BracketVisualization({
  rounds,
  currentPlayerId,
  featuredMatchId,
}: {
  rounds: TournamentRound[];
  currentPlayerId?: string;
  featuredMatchId?: string | null;
}) {
  if (rounds.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No bracket data available yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-6 min-w-fit pb-4">
        {rounds.map((round) => (
          <div key={round.roundIndex} className="flex flex-col gap-3 min-w-[240px]">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {round.label}
            </h4>
            <div className="flex flex-col gap-2">
              {round.matches.map((match) => (
                <MatchCard
                  key={match.matchId}
                  match={match}
                  currentPlayerId={currentPlayerId}
                  featured={match.matchId === featuredMatchId}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
