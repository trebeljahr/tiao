import { useState, useCallback, useEffect, useRef } from "react";
import { AuthResponse, MultiplayerGamesIndex, PlayerColor, PlayerIdentity } from "@shared";
import { listMultiplayerGames } from "../api";
import { fetchWithRetry } from "../fetchWithRetry";
import { useLobbyMessage } from "../LobbySocketContext";

/** Shape of the player-identity-update broadcast sent from gameService. */
type PlayerIdentityUpdatePayload = {
  type: "player-identity-update";
  playerId: string;
  displayName?: string;
  profilePicture?: string;
  rating?: number;
  activeBadges?: string[];
};

function applyIdentityPatch(
  player: PlayerIdentity,
  patch: PlayerIdentityUpdatePayload,
): PlayerIdentity {
  return {
    ...player,
    displayName: patch.displayName ?? player.displayName,
    profilePicture: patch.profilePicture ?? player.profilePicture,
    rating: patch.rating ?? player.rating,
    activeBadges: patch.activeBadges ?? player.activeBadges,
  };
}

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

  // Patch any player identity changes (e.g. a badge equip) into both the
  // active and finished games lists so cached rows update in real time.
  useLobbyMessage((payload) => {
    if (payload.type !== "player-identity-update") return;
    const patch = payload as PlayerIdentityUpdatePayload;
    if (!patch.playerId) return;

    setMultiplayerGames((prev) => {
      let touched = false;
      const patchList = (list: MultiplayerGamesIndex["active"]) =>
        list.map((game) => {
          let gameTouched = false;
          const nextSeats = { ...game.seats } as typeof game.seats;
          for (const color of ["white", "black"] as PlayerColor[]) {
            const seat = nextSeats[color];
            if (seat?.player.playerId === patch.playerId) {
              nextSeats[color] = {
                ...seat,
                player: applyIdentityPatch(seat.player, patch),
              };
              gameTouched = true;
            }
          }
          if (!gameTouched) return game;
          touched = true;
          return { ...game, seats: nextSeats };
        });

      const nextActive = patchList(prev.active);
      const nextFinished = patchList(prev.finished);
      if (!touched) return prev;
      return { active: nextActive, finished: nextFinished };
    });
  });

  return {
    multiplayerGames,
    multiplayerGamesLoading,
    multiplayerGamesLoaded,
    refreshMultiplayerGames,
  };
}
