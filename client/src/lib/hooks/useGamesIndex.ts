import { useState, useCallback, useEffect, useRef } from "react";
import { AuthResponse, MultiplayerGamesIndex } from "@shared";
import { listMultiplayerGames } from "../api";
import { fetchWithRetry } from "../fetchWithRetry";

export function useGamesIndex(auth: AuthResponse | null) {
  const [multiplayerGames, setMultiplayerGames] = useState<MultiplayerGamesIndex>({
    active: [],
    finished: [],
  });
  const [multiplayerGamesLoading, setMultiplayerGamesLoading] = useState(false);
  const [multiplayerGamesLoaded, setMultiplayerGamesLoaded] = useState(false);

  // Reset loaded state when the player identity changes (e.g. after logout)
  const prevPlayerIdRef = useRef(auth?.player.playerId ?? null);
  useEffect(() => {
    const currentPlayerId = auth?.player.playerId ?? null;
    if (currentPlayerId !== prevPlayerIdRef.current) {
      prevPlayerIdRef.current = currentPlayerId;
      setMultiplayerGames({ active: [], finished: [] });
      setMultiplayerGamesLoaded(false);
      setMultiplayerGamesLoading(false);
    }
  }, [auth?.player.playerId]);

  const applyMultiplayerGamesIndex = useCallback((nextGames: MultiplayerGamesIndex) => {
    setMultiplayerGames({
      active: nextGames?.active ?? [],
      finished: nextGames?.finished ?? [],
    });
    setMultiplayerGamesLoaded(true);
  }, []);

  const refreshMultiplayerGames = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!auth) {
        setMultiplayerGames({
          active: [],
          finished: [],
        });
        setMultiplayerGamesLoaded(false);
        setMultiplayerGamesLoading(false);
        return;
      }

      setMultiplayerGamesLoading(true);

      try {
        const response = options.silent
          ? await listMultiplayerGames()
          : await fetchWithRetry(() => listMultiplayerGames(), "games");
        applyMultiplayerGamesIndex(response.games);
      } catch {
        // Mark as loaded even on error to prevent infinite retry loops
        setMultiplayerGamesLoaded(true);
      } finally {
        setMultiplayerGamesLoading(false);
      }
    },
    [auth, applyMultiplayerGamesIndex],
  );

  // Initial fetch — only runs once per auth identity (guarded by multiplayerGamesLoaded)
  const refreshRef = useRef(refreshMultiplayerGames);
  refreshRef.current = refreshMultiplayerGames;
  useEffect(() => {
    if (auth && !multiplayerGamesLoaded && !multiplayerGamesLoading) {
      void refreshRef.current();
    }
  }, [auth, multiplayerGamesLoaded, multiplayerGamesLoading]);

  return {
    multiplayerGames,
    multiplayerGamesLoading,
    multiplayerGamesLoaded,
    refreshMultiplayerGames,
  };
}
