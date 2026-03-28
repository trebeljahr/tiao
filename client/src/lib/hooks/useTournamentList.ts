import { useCallback, useEffect, useState } from "react";
import type { AuthResponse, TournamentListItem, TournamentStatus } from "@shared";
import { listPublicTournaments, listMyTournaments } from "@/lib/api";
import { useLobbyMessage } from "@/lib/LobbySocketContext";

export function useTournamentList(
  auth: AuthResponse | null,
  options?: { status?: TournamentStatus },
) {
  const [publicTournaments, setPublicTournaments] = useState<TournamentListItem[]>([]);
  const [myTournaments, setMyTournaments] = useState<TournamentListItem[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);

      try {
        const [pubResult, myResult] = await Promise.all([
          listPublicTournaments(options?.status),
          auth?.player.kind === "account"
            ? listMyTournaments()
            : Promise.resolve({ tournaments: [] as TournamentListItem[] }),
        ]);
        setPublicTournaments(pubResult.tournaments);
        setMyTournaments(myResult.tournaments);
      } catch {
        // Silently fail — tournaments aren't critical
      } finally {
        setLoading(false);
      }
    },
    [auth, options?.status],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-refresh on tournament updates
  useLobbyMessage(
    useCallback(
      (payload) => {
        if (payload.type === "tournament-update") {
          refresh({ silent: true });
        }
      },
      [refresh],
    ),
  );

  return {
    publicTournaments,
    myTournaments,
    loading,
    refresh,
  };
}
