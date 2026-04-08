import { useState, useCallback, useEffect, useRef } from "react";
import type {
  AuthResponse,
  LobbyServerMessage,
  MatchmakingState,
  MultiplayerSnapshot,
  TimeControl,
} from "@shared";
import { useLobbyMessage, useLobbySocket } from "../LobbySocketContext";
import { toastError } from "../errors";

/**
 * Matchmaking hook backed by the lobby WebSocket.
 *
 * The queue entry's lifetime is tied to the socket that sent
 * `matchmaking:enter` — closing the tab / navigating away / crashing all fire
 * the server-side `close` handler, which clears the entry before the sweep
 * can pair a ghost with a real player. We still send `matchmaking:leave` on
 * unmount so that navigating *within* the SPA (socket stays open) also frees
 * the slot immediately.
 */
export function useMatchmakingData(
  auth: AuthResponse | null,
  onMatched: (snapshot: MultiplayerSnapshot) => void,
  onPreempted?: () => void,
) {
  const [matchmaking, setMatchmaking] = useState<MatchmakingState>({ status: "idle" });
  const [matchmakingBusy, setMatchmakingBusy] = useState(false);
  // True once the server told us a different tab/browser of the same account
  // took over the matchmaking session. Sticky — the MatchmakingPage reads
  // this to suppress its auto-re-enter effect so the two tabs don't
  // ping-pong the queue.
  const [preempted, setPreempted] = useState(false);
  const { sendMessage } = useLobbySocket();

  // Refs so the unmount effect can read the latest state without re-running.
  const statusRef = useRef(matchmaking.status);
  useEffect(() => {
    statusRef.current = matchmaking.status;
  }, [matchmaking.status]);

  const sendMessageRef = useRef(sendMessage);
  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  const onMatchedRef = useRef(onMatched);
  useEffect(() => {
    onMatchedRef.current = onMatched;
  }, [onMatched]);

  const onPreemptedRef = useRef(onPreempted);
  useEffect(() => {
    onPreemptedRef.current = onPreempted;
  }, [onPreempted]);

  useLobbyMessage((payload: Record<string, unknown>) => {
    const msg = payload as LobbyServerMessage;
    if (msg.type === "matchmaking:state") {
      setMatchmaking(msg.state);
      setMatchmakingBusy(false);
      // An immediate match (second player to enter the queue) comes back as
      // `matchmaking:state { status: "matched", snapshot }` in direct reply
      // to the initiator. Trigger the same routing path as the
      // `matchmaking:matched` push the waiting opponent receives.
      if (msg.state.status === "matched") {
        onMatchedRef.current(msg.state.snapshot);
      }
      return;
    }
    if (msg.type === "matchmaking:matched") {
      setMatchmaking({ status: "matched", snapshot: msg.snapshot });
      setMatchmakingBusy(false);
      onMatchedRef.current(msg.snapshot);
      return;
    }
    if (msg.type === "matchmaking:preempted") {
      // Another tab/browser of the same account took over the search.
      // Flip to idle + preempted so the page can navigate away and won't
      // auto-re-enter (which would kick the other tab out).
      setMatchmaking({ status: "idle" });
      setMatchmakingBusy(false);
      setPreempted(true);
      // Also nuke the socket-owner mapping on the client side: if the user
      // manually re-enters later, we want a fresh ownership claim.
      onPreemptedRef.current?.();
      return;
    }
    if (msg.type === "matchmaking:resumable") {
      // The tab that preempted us cancelled/disconnected without matching.
      // Clear the sticky flag so the MatchmakingPage's auto-re-enter effect
      // can fire again and put us back into the queue.
      setPreempted(false);
      return;
    }
    if (msg.type === "matchmaking:error") {
      toastError(new Error(msg.message));
      setMatchmaking({ status: "idle" });
      setMatchmakingBusy(false);
      return;
    }
  });

  const handleEnterMatchmaking = useCallback(
    async (timeControl?: TimeControl) => {
      if (!auth) return;
      setMatchmakingBusy(true);
      sendMessageRef.current({
        type: "matchmaking:enter",
        timeControl: timeControl ?? null,
      });
    },
    [auth],
  );

  const handleCancelMatchmaking = useCallback(async () => {
    setMatchmakingBusy(true);
    sendMessageRef.current({ type: "matchmaking:leave" });
    // Optimistic: the server will confirm with `matchmaking:state { idle }`,
    // but the UI should flip immediately so the cancel button doesn't spin.
    setMatchmaking({ status: "idle" });
    setMatchmakingBusy(false);
  }, []);

  // Unmount cleanup for SPA navigation: the socket stays open when we route
  // to another page inside the app, so the server's close handler won't fire.
  // Send an explicit leave iff we were still searching. Matched players skip
  // this — sending leave would make the server call deleteMatch and clobber
  // the freshly created room as the router pushes to /game/:id.
  useEffect(() => {
    return () => {
      if (statusRef.current === "searching") {
        sendMessageRef.current({ type: "matchmaking:leave" });
      }
    };
  }, []);

  return {
    matchmaking,
    setMatchmaking,
    matchmakingBusy,
    preempted,
    handleEnterMatchmaking,
    handleCancelMatchmaking,
  };
}
