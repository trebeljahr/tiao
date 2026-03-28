import { useCallback, useEffect, useState } from "react";
import type { AuthResponse, TournamentSnapshot } from "@shared";
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
      } catch (err: any) {
        setError(err.message ?? "Failed to load tournament.");
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
