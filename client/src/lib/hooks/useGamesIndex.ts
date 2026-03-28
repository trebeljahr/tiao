import { useState, useCallback, useEffect } from "react";
import { AuthResponse, MultiplayerGamesIndex } from "@shared";
import { listMultiplayerGames } from "../api";
import { toastError } from "../errors";

export function useGamesIndex(auth: AuthResponse | null) {
  const [multiplayerGames, setMultiplayerGames] =
    useState<MultiplayerGamesIndex>({
      active: [],
      finished: [],
    });
  const [multiplayerGamesLoading, setMultiplayerGamesLoading] = useState(false);
  const [multiplayerGamesLoaded, setMultiplayerGamesLoaded] = useState(false);

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
        const response = await listMultiplayerGames();
        applyMultiplayerGamesIndex(response.games);
      } catch (error) {
        if (!options.silent) {
          toastError(error);
        }
      } finally {
        setMultiplayerGamesLoading(false);
      }
    },
    [auth, applyMultiplayerGamesIndex],
  );

  useEffect(() => {
    if (auth && !multiplayerGamesLoaded && !multiplayerGamesLoading) {
      void refreshMultiplayerGames();
    }
  }, [auth, multiplayerGamesLoaded, multiplayerGamesLoading, refreshMultiplayerGames]);

  return {
    multiplayerGames,
    multiplayerGamesLoading,
    multiplayerGamesLoaded,
    refreshMultiplayerGames,
  };
}
