import { useLobbyMessage } from "@/lib/LobbySocketContext";
import { getMyNextTournamentMatch } from "@/lib/api";
import type { MyNextMatchResult } from "@shared";
import { useCallback, useEffect, useState } from "react";

/**
 * Fetches the server's decision about what this player should do next in
 * the given tournament. The returned `result` powers the post-game CTA
 * (next match / view results / spectate while waiting) in
 * MultiplayerGamePage.
 *
 * Refreshes automatically on `tournament-update` and
 * `tournament-match-ready` messages so the client reacts the instant the
 * bracket moves forward — without relying on the 10-second post-game
 * redirect timer for correctness.
 */
export function useTournamentNextMatch(tournamentId: string | null) {
  const [result, setResult] = useState<MyNextMatchResult | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!tournamentId) return;
    setLoading(true);
    try {
      const { result } = await getMyNextTournamentMatch(tournamentId);
      setResult(result);
    } catch {
      // Silent — the caller falls back to "back to tournament" if this fails.
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);

  // Don't fire any effects or fetches when there's no tournamentId — most
  // game pages aren't tournament games and the hook is mounted there too.
  // An idle no-op effect (with even a benign setState) under heavy parallel
  // load contributes enough async churn to flake unrelated tests in the
  // matchmaking game-page suite.
  useEffect(() => {
    if (!tournamentId) return;
    void refresh();
  }, [tournamentId, refresh]);

  useLobbyMessage(
    useCallback(
      (payload) => {
        if (!tournamentId) return;
        if (
          (payload.type === "tournament-update" ||
            payload.type === "tournament-match-ready" ||
            payload.type === "tournament-round-complete") &&
          payload.tournamentId === tournamentId
        ) {
          void refresh();
        }
        // When a tournament game ends, the server processes the result and
        // advances the bracket asynchronously. Refresh after a short delay
        // so the "View tournament results" CTA appears without waiting for
        // the next socket broadcast.
        if (payload.type === "game-over") {
          setTimeout(() => void refresh(), 500);
        }
      },
      [tournamentId, refresh],
    ),
  );

  return { result, loading, refresh };
}
