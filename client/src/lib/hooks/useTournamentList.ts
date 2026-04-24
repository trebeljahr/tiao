import { useLobbyMessage } from "@/lib/LobbySocketContext";
import { listMyTournaments, listPublicTournaments } from "@/lib/api";
import type { AuthResponse, TournamentListItem, TournamentStatus } from "@shared";
import { useCallback, useEffect, useState } from "react";

export function useTournamentList(
  auth: AuthResponse | null,
  options?: { status?: TournamentStatus },
) {
  const [publicTournaments, setPublicTournaments] = useState<TournamentListItem[]>([]);
  const [myTournaments, setMyTournaments] = useState<TournamentListItem[]>([]);
  const [loading, setLoading] = useState(true);

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

  // Auto-refresh on tournament updates. `tournament-update` is only sent
  // to participants/creator, so without `tournament-list-update` (which
  // is broadcast globally on create/start/cancel/finish/featured-toggle)
  // non-participant lobby viewers never see new tournaments appear.
  useLobbyMessage(
    useCallback(
      (payload) => {
        if (payload.type === "tournament-update" || payload.type === "tournament-list-update") {
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
