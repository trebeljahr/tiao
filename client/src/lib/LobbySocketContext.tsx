import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useCallback,
} from "react";
import type { AuthResponse } from "@shared";
import { buildWebSocketUrl } from "./api";
import { createReconnectScheduler } from "./reconnect";

type LobbyMessageHandler = (payload: Record<string, unknown>) => void;

type LobbySocketContextValue = {
  subscribe: (handler: LobbyMessageHandler) => () => void;
};

const LobbySocketContext = createContext<LobbySocketContextValue>({
  subscribe: () => () => {},
});

export function useLobbyMessage(handler: LobbyMessageHandler) {
  const { subscribe } = useContext(LobbySocketContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    return subscribe((payload) => handlerRef.current(payload));
  }, [subscribe]);
}

export function LobbySocketProvider({
  auth,
  children,
}: {
  auth: AuthResponse | null;
  children: React.ReactNode;
}) {
  const subscribersRef = useRef<Set<LobbyMessageHandler>>(new Set());

  const subscribe = useCallback((handler: LobbyMessageHandler) => {
    subscribersRef.current.add(handler);
    return () => {
      subscribersRef.current.delete(handler);
    };
  }, []);

  useEffect(() => {
    if (!auth || auth.player.kind !== "account") return;

    let socket: WebSocket | null = null;

    const reconnect = createReconnectScheduler(connect, {
      baseDelayMs: 1500,
      maxDelayMs: 10000,
    });

    function connect() {
      const url = new URL(buildWebSocketUrl("lobby"));
      url.pathname = "/api/ws/lobby";
      url.searchParams.delete("gameId");

      socket = new WebSocket(url.toString());

      socket.onopen = () => {
        reconnect.reset();
      };

      socket.onmessage = (event) => {
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }
        for (const handler of subscribersRef.current) {
          handler(payload);
        }
      };

      socket.onclose = () => {
        socket = null;
        reconnect.schedule();
      };

      socket.onerror = () => {
        socket?.close();
      };
    }

    connect();

    return () => {
      reconnect.clear();
      socket?.close();
    };
  }, [auth]);

  return (
    <LobbySocketContext.Provider value={{ subscribe }}>
      {children}
    </LobbySocketContext.Provider>
  );
}
