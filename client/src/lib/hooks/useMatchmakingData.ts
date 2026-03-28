import { useState, useCallback, useEffect, useRef } from "react";
import { AuthResponse, MatchmakingState, MultiplayerSnapshot, TimeControl } from "@shared";
import { enterMatchmaking, leaveMatchmaking, getMatchmakingState } from "../api";
import { toastError } from "../errors";

export function useMatchmakingData(
  auth: AuthResponse | null,
  onMatched: (snapshot: MultiplayerSnapshot) => void,
) {
  const [matchmaking, setMatchmaking] = useState<MatchmakingState>({
    status: "idle",
  });
  const [matchmakingBusy, setMatchmakingBusy] = useState(false);
  const pollTimerRef = useRef<number | null>(null);

  const stopMatchmaking = useCallback(async (options: { silent?: boolean } = {}) => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    try {
      await leaveMatchmaking();
      setMatchmaking({ status: "idle" });
    } catch (error) {
      if (!options.silent) {
        toastError(error);
      }
    }
  }, []);

  const pollMatchmakingStatus = useCallback(async () => {
    try {
      const response = await getMatchmakingState();
      setMatchmaking(response.matchmaking);

      if (response.matchmaking.status === "matched") {
        if (pollTimerRef.current !== null) {
          window.clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
        onMatched(response.matchmaking.snapshot);
      }
    } catch {
      // Silent error for polling
    }
  }, [onMatched]);

  const startPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
    }
    pollTimerRef.current = window.setInterval(pollMatchmakingStatus, 2000);
  }, [pollMatchmakingStatus]);

  const handleEnterMatchmaking = useCallback(
    async (timeControl?: TimeControl) => {
      if (!auth) {
        return;
      }

      setMatchmakingBusy(true);

      try {
        const response = await enterMatchmaking(timeControl ? { timeControl } : undefined);
        setMatchmaking(response.matchmaking);

        if (response.matchmaking.status === "matched") {
          onMatched(response.matchmaking.snapshot);
        } else if (response.matchmaking.status === "searching") {
          startPolling();
        }
      } catch (error) {
        toastError(error);
        setMatchmaking({ status: "idle" } as MatchmakingState);
        throw error; // Re-throw so callers can catch
      } finally {
        setMatchmakingBusy(false);
      }
    },
    [auth, onMatched, stopMatchmaking, startPolling],
  );

  const handleCancelMatchmaking = useCallback(async () => {
    setMatchmakingBusy(true);
    try {
      await stopMatchmaking({ silent: false });
    } finally {
      setMatchmakingBusy(false);
    }
  }, [stopMatchmaking]);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
      }
    };
  }, []);

  return {
    matchmaking,
    setMatchmaking,
    matchmakingBusy,
    handleEnterMatchmaking,
    handleCancelMatchmaking,
    stopMatchmaking,
  };
}
