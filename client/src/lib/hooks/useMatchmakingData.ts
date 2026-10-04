import type {
  AuthResponse,
  LobbyServerMessage,
  MatchmakingState,
  MultiplayerSnapshot,
  TimeControl,
} from "@shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { toastError } from "../errors";
import { useLobbyMessage, useLobbySocket } from "../LobbySocketContext";

function createSearchId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Some native WebViews expose secure random bytes but not randomUUID.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type SavedSearch = {
  playerId: string;
  attemptId: string;
  timeControl: TimeControl;
  savedAt: number;
};

// Tab-scoped, so a full-page reload (for example onto a new release) resumes
// the same search instead of creating a second identity. Expiry bounds how long
// a forgotten tab can revive an old search.
const SAVED_SEARCH_KEY = "tiao:matchmaking-search:v1";
const SAVED_SEARCH_TTL_MS = 15 * 60_000;

function sameTimeControl(a: TimeControl, b: TimeControl): boolean {
  return a === null || b === null
    ? a === b
    : a.initialMs === b.initialMs && a.incrementMs === b.incrementMs;
}

function clearSavedSearch(): void {
  try {
    window.sessionStorage.removeItem(SAVED_SEARCH_KEY);
  } catch {
    // Storage unavailable: nothing persisted to clear.
  }
}

function loadSavedSearch(playerId: string): SavedSearch | null {
  try {
    const raw = window.sessionStorage.getItem(SAVED_SEARCH_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<SavedSearch>;
    const tc = saved.timeControl;
    if (
      saved.playerId === playerId &&
      typeof saved.attemptId === "string" &&
      typeof saved.savedAt === "number" &&
      Date.now() - saved.savedAt < SAVED_SEARCH_TTL_MS &&
      (tc === null ||
        (typeof tc === "object" &&
          typeof tc?.initialMs === "number" &&
          typeof tc?.incrementMs === "number"))
    )
      return saved as SavedSearch;
  } catch {
    // Unreadable or corrupt storage: start a new search.
  }
  clearSavedSearch();
  return null;
}

/** Returns false when storage refuses the write; the search then lives in memory only. */
function saveSearch(search: SavedSearch): boolean {
  try {
    window.sessionStorage.setItem(SAVED_SEARCH_KEY, JSON.stringify(search));
    return true;
  } catch {
    return false;
  }
}

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
  // One search identity survives socket loss. The server persists it with the
  // room so replaying a lost matched reply cannot create another game.
  const searchRef = useRef<{ attemptId: string; timeControl: TimeControl } | null>(null);
  const searchOwnerRef = useRef(auth?.player.playerId);
  if (searchOwnerRef.current !== auth?.player.playerId) {
    searchRef.current = null;
    // Auth hydrating after a reload is not an account change; keep the intent.
    if (searchOwnerRef.current !== undefined) clearSavedSearch();
    searchOwnerRef.current = auth?.player.playerId;
  }

  // Refs so the unmount effect can read the latest state without re-running.
  const errorStreakRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(retryTimerRef.current), []);
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
    if (payload.type === "lobby:open") {
      const search = searchRef.current;
      if (search) sendMessageRef.current({ type: "matchmaking:enter-v2", ...search });
      return;
    }
    const msg = payload as LobbyServerMessage;
    if (
      (msg.type === "matchmaking:matched" ||
        msg.type === "matchmaking:state" ||
        msg.type === "matchmaking:error") &&
      msg.attemptId &&
      msg.attemptId !== searchRef.current?.attemptId
    )
      return;
    if (msg.type === "matchmaking:state") {
      if (msg.state.status !== "idle") errorStreakRef.current = 0;
      setMatchmaking(msg.state);
      setMatchmakingBusy(false);
      // An immediate match (second player to enter the queue) comes back as
      // `matchmaking:state { status: "matched", snapshot }` in direct reply
      // to the initiator. Trigger the same routing path as the
      // `matchmaking:matched` push the waiting opponent receives.
      if (msg.state.status === "matched") {
        searchRef.current = null;
        clearSavedSearch();
        onMatchedRef.current(msg.state.snapshot);
      }
      return;
    }
    if (msg.type === "matchmaking:matched") {
      searchRef.current = null;
      clearSavedSearch();
      setMatchmaking({ status: "matched", snapshot: msg.snapshot });
      setMatchmakingBusy(false);
      onMatchedRef.current(msg.snapshot);
      return;
    }
    if (
      msg.type === "matchmaking:preempted" ||
      (msg.type === "matchmaking:error" && msg.code === "SEARCH_SUPERSEDED")
    ) {
      searchRef.current = null;
      clearSavedSearch();
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
      if (msg.code === "SEARCH_ID_REUSED") {
        // The saved id belongs to a different time control; never resend it.
        searchRef.current = null;
        clearSavedSearch();
      }
      toastError(new Error(msg.message));
      setMatchmaking({ status: "idle" });
      // Stay busy for a growing delay so the page's auto-enter cannot spin on
      // a persistent error (lock timeout, presence not yet visible).
      const delay = Math.min(1000 * 2 ** errorStreakRef.current++, 30_000);
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => setMatchmakingBusy(false), delay);
      return;
    }
  });

  const handleEnterMatchmaking = useCallback(
    async (timeControl?: TimeControl) => {
      if (!auth || searchOwnerRef.current !== auth.player.playerId) return;
      setMatchmakingBusy(true);
      if (!searchRef.current) {
        const requested = timeControl ?? null;
        const saved = loadSavedSearch(auth.player.playerId);
        searchRef.current =
          saved && sameTimeControl(saved.timeControl, requested)
            ? { attemptId: saved.attemptId, timeControl: saved.timeControl }
            : { attemptId: createSearchId(), timeControl: requested };
      }
      // Save before the first send so a reload cannot lose an id the server saw.
      saveSearch({ playerId: auth.player.playerId, ...searchRef.current, savedAt: Date.now() });
      sendMessageRef.current({ type: "matchmaking:enter-v2", ...searchRef.current });
    },
    [auth],
  );

  const handleCancelMatchmaking = useCallback(async () => {
    searchRef.current = null;
    clearSavedSearch();
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
      if (statusRef.current === "searching" || searchRef.current) {
        searchRef.current = null;
        clearSavedSearch();
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
