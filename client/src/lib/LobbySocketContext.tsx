import { createContext, useContext, useEffect, useMemo, useRef, useCallback } from "react";
import type { AuthResponse, LobbyClientMessage } from "@shared";
import { buildWebSocketUrl } from "./api";
import { createReconnectScheduler } from "./reconnect";

// The server sends a zoo of loosely-typed messages on this channel
// (game-update, social-update, achievement-*, tournament-*,
// player-identity-update, matchmaking:*). Consumers narrow by `type` at runtime
// rather than sharing a discriminated union — see `LobbyServerMessage` in
// shared/src/protocol.ts for the subset that is formally typed.
type LobbyMessageHandler = (payload: Record<string, unknown>) => void;

type LobbySocketContextValue = {
  subscribe: (handler: LobbyMessageHandler) => () => void;
  sendMessage: (message: LobbyClientMessage) => void;
};

const LobbySocketContext = createContext<LobbySocketContextValue>({
  subscribe: () => () => {},
  sendMessage: () => {},
});

export function useLobbyMessage(handler: LobbyMessageHandler) {
  const { subscribe } = useContext(LobbySocketContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    return subscribe((payload) => handlerRef.current(payload));
  }, [subscribe]);
}

export function useLobbySocket() {
  return useContext(LobbySocketContext);
}

export function LobbySocketProvider({
  auth,
  children,
}: {
  auth: AuthResponse | null;
  children: React.ReactNode;
}) {
  const subscribersRef = useRef<Set<LobbyMessageHandler>>(new Set());
  const socketRef = useRef<WebSocket | null>(null);
  // Queue of outbound messages sent while the socket is closed/reconnecting.
  // Flushed on the next `open` event so a matchmaking page that mounts during
  // a reconnect doesn't silently drop its `matchmaking:enter`.
  const pendingRef = useRef<LobbyClientMessage[]>([]);

  const subscribe = useCallback((handler: LobbyMessageHandler) => {
    subscribersRef.current.add(handler);
    return () => {
      subscribersRef.current.delete(handler);
    };
  }, []);

  const sendMessage = useCallback((message: LobbyClientMessage) => {
    // Guard against an accidental circular reference sneaking in
    // (e.g. a React element or DOM node passed through by mistake).
    // A throw here would propagate out of whatever user action
    // triggered the send and could blow up the page under whatever
    // error boundary is above it.
    let serialized: string;
    try {
      serialized = JSON.stringify(message);
    } catch (err) {
      console.error("[lobby] failed to serialize outbound message", err, {
        type: (message as { type?: string }).type,
      });
      return;
    }
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(serialized);
    } else {
      pendingRef.current.push(message);
    }
  }, []);

  useEffect(() => {
    // Lobby socket now supports both accounts and guests: matchmaking relies on
    // socket lifetime for queue cleanup, so guests need a channel too.
    if (!auth) return;

    const reconnect = createReconnectScheduler(connect, {
      baseDelayMs: 1500,
      maxDelayMs: 10000,
    });

    function connect() {
      const url = new URL(buildWebSocketUrl("lobby"));
      url.pathname = "/api/ws/lobby";
      url.searchParams.delete("gameId");

      const socket = new WebSocket(url.toString());
      socketRef.current = socket;

      socket.onopen = () => {
        reconnect.reset();
        // Flush any messages that were enqueued while the socket was down.
        // Same try/catch wrapping as sendMessage — one bad message in the
        // queue shouldn't poison the whole flush loop.
        const pending = pendingRef.current;
        pendingRef.current = [];
        for (const message of pending) {
          try {
            socket.send(JSON.stringify(message));
          } catch (err) {
            console.error("[lobby] failed to flush queued message", err, {
              type: (message as { type?: string }).type,
            });
          }
        }

        // Notify subscribers that the socket just opened, so any state
        // that relies on server pushes can re-sync from REST in case a
        // broadcast was missed during a disconnect window. Critical on
        // mobile: a wifi↔5G handover or CGNAT idle-kill silently tears
        // down the WS and reconnects in seconds. If a server broadcast
        // (e.g. data-export ready) fires inside that gap the client
        // never learns about it — this synthetic event is the signal to
        // refetch. Uses the same delivery path + error isolation as
        // real messages.
        const openEvent = { type: "lobby:open" } as const;
        for (const handler of subscribersRef.current) {
          try {
            handler(openEvent);
          } catch (err) {
            console.error("[lobby] subscriber handler threw on lobby:open", err);
          }
        }
      };

      socket.onmessage = (event) => {
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }
        // Isolate subscribers from each other: one handler throwing
        // must not stop delivery to the others. Previously a bug in
        // any single consumer would break every other subscriber on
        // every subsequent message until page reload.
        for (const handler of subscribersRef.current) {
          try {
            handler(payload);
          } catch (err) {
            console.error("[lobby] subscriber handler threw", err, {
              type: (payload as { type?: unknown }).type,
            });
          }
        }
      };

      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null;
        reconnect.schedule();
      };

      socket.onerror = () => {
        socket.close();
      };
    }

    connect();

    return () => {
      reconnect.clear();
      socketRef.current?.close();
      socketRef.current = null;
      pendingRef.current = [];
    };
  }, [auth]);

  // Memoize so consumers of useLobbyMessage don't re-subscribe every render.
  const value = useMemo(() => ({ subscribe, sendMessage }), [subscribe, sendMessage]);

  return <LobbySocketContext.Provider value={value}>{children}</LobbySocketContext.Provider>;
}
