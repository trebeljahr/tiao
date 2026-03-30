import { useCallback, useEffect, useState } from "react";
import type {
  AuthResponse,
  TournamentGroup,
  TournamentMatch,
  TournamentRound,
  TournamentSnapshot,
} from "@shared";
import { getTournament } from "@/lib/api";
import { useLobbyMessage } from "@/lib/LobbySocketContext";

export function useTournament(
  _auth: AuthResponse | null,
  tournamentId: string | null,
  options?: {
    onMatchReady?: (matchId: string, roomId: string) => void;
    onRoundComplete?: (roundIndex: number) => void;
  },
) {
  const [tournament, setTournament] = useState<TournamentSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTournament = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!tournamentId) return;
      if (!opts?.silent) setLoading(true);
      setError(null);

      try {
        const { tournament } = await getTournament(tournamentId);
        setTournament(tournament);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load tournament.");
      } finally {
        setLoading(false);
      }
    },
    [tournamentId],
  );

  useEffect(() => {
    fetchTournament();
  }, [fetchTournament]);

  // Listen for tournament updates via lobby socket
  useLobbyMessage(
    useCallback(
      (payload) => {
        if (!tournamentId) return;

        if (payload.type === "tournament-update" && payload.tournamentId === tournamentId) {
          fetchTournament({ silent: true });
        }

        if (payload.type === "tournament-match-ready" && payload.tournamentId === tournamentId) {
          options?.onMatchReady?.(payload.matchId as string, payload.roomId as string);
          fetchTournament({ silent: true });
        }

        if (payload.type === "tournament-round-complete" && payload.tournamentId === tournamentId) {
          options?.onRoundComplete?.(payload.roundIndex as number);
          fetchTournament({ silent: true });
        }

        if (payload.type === "tournament-score-update" && payload.tournamentId === tournamentId) {
          setTournament((prev) => {
            if (!prev) return prev;
            const updated = structuredClone(prev);
            const allRounds: TournamentRound[] = [
              ...(updated.rounds ?? []),
              ...(updated.knockoutRounds ?? []),
              ...(updated.groups ?? []).flatMap((g: TournamentGroup) => g.rounds ?? []),
            ];
            for (const round of allRounds) {
              const match = round.matches.find(
                (m: TournamentMatch) => m.matchId === payload.matchId,
              );
              if (match) {
                match.score = payload.score as [number, number];
                break;
              }
            }
            return updated;
          });
        }
      },
      [tournamentId, fetchTournament, options?.onMatchReady, options?.onRoundComplete],
    ),
  );

  return {
    tournament,
    loading,
    error,
    refresh: fetchTournament,
  };
}
