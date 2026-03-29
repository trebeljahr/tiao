import { useState, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  AuthResponse,
  GameState,
  Position,
  MultiplayerSnapshot,
  ClientToServerMessage,
  ServerToClientMessage,
  jumpPiece,
  placePiece,
  confirmPendingJump,
  undoPendingJumpStep,
  getPendingJumpDestination,
} from "@shared";
import { buildWebSocketUrl, accessMultiplayerGame, getMultiplayerGame } from "../api";
import { readableError, isNetworkError } from "../errors";
import { createReconnectScheduler } from "../reconnect";
import { createOptimisticSnapshot } from "../../components/game/GameShared";

export type ConnectionState = "idle" | "connecting" | "connected" | "disconnected";

export type GameAbortedInfo = {
  reason: string;
  requeuedForMatchmaking: boolean;
  timeControl: import("@shared").TimeControl;
};

export function useMultiplayerGame(
  auth: AuthResponse | null,
  gameId: string | null,
  options: {
    onSync?: () => void;
    onRematchStarted?: (newGameId: string) => void;
    onGameAborted?: (info: GameAbortedInfo) => void;
    websocketDebugEnabled?: boolean;
    spectateOnly?: boolean;
  } = {},
) {
  const [multiplayerSnapshot, setMultiplayerSnapshot] = useState<MultiplayerSnapshot | null>(null);
  const [multiplayerSelection, setMultiplayerSelection] = useState<Position | null>(null);
  const [multiplayerError, setMultiplayerError] = useState<string | null>(null);
  const [multiplayerBusy, setMultiplayerBusy] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");

  const onRematchStartedRef = useRef(options.onRematchStarted);
  onRematchStartedRef.current = options.onRematchStarted;

  const onGameAbortedRef = useRef(options.onGameAborted);
  onGameAbortedRef.current = options.onGameAborted;

  const socketRef = useRef<WebSocket | null>(null);
  const latestAuthRef = useRef<AuthResponse | null>(auth);
  const latestMultiplayerSnapshotRef = useRef<MultiplayerSnapshot | null>(multiplayerSnapshot);
  const confirmedMultiplayerSnapshotRef = useRef<MultiplayerSnapshot | null>(null);
  const pendingOptimisticUpdateRef = useRef(false);

  useEffect(() => {
    latestAuthRef.current = auth;
  }, [auth]);

  useEffect(() => {
    latestMultiplayerSnapshotRef.current = multiplayerSnapshot;
  }, [multiplayerSnapshot]);

  const logWebSocketDebug = useCallback(
    (event: string, details?: Record<string, unknown>) => {
      if (!options.websocketDebugEnabled) {
        return;
      }
      console.info("[tiao ws]", event, details ?? {});
    },
    [options.websocketDebugEnabled],
  );

  const reconnectRef = useRef(
    createReconnectScheduler(() => {
      void reconnectToCurrentRoomRef.current();
    }),
  );
  const reconnectToCurrentRoomRef = useRef<() => Promise<void>>(async () => {});

  const commitMultiplayerSnapshot = useCallback(
    (
      nextSnapshot: MultiplayerSnapshot,
      options: {
        confirmed?: boolean;
      } = {},
    ) => {
      if (options.confirmed ?? true) {
        confirmedMultiplayerSnapshotRef.current = nextSnapshot;
        pendingOptimisticUpdateRef.current = false;
      }
      setMultiplayerSnapshot(nextSnapshot);
    },
    [],
  );

  const syncMultiplayerSelection = useCallback((snapshot: MultiplayerSnapshot | null) => {
    setMultiplayerSelection(snapshot ? getPendingJumpDestination(snapshot.state) : null);
  }, []);

  const restoreConfirmedSnapshot = useCallback(() => {
    const confirmedSnapshot = confirmedMultiplayerSnapshotRef.current;
    pendingOptimisticUpdateRef.current = false;
    if (!confirmedSnapshot) {
      return;
    }
    commitMultiplayerSnapshot(confirmedSnapshot, { confirmed: false });
    syncMultiplayerSelection(confirmedSnapshot);
  }, [commitMultiplayerSnapshot, syncMultiplayerSelection]);

  const handleUnexpectedMultiplayerDisconnect = useCallback(() => {
    const reconnect = reconnectRef.current;
    logWebSocketDebug("unexpected-disconnect", {
      reconnectAttempt: reconnect.getAttempt(),
      hasSnapshot: !!latestMultiplayerSnapshotRef.current,
    });
    setConnectionState("disconnected");

    if (pendingOptimisticUpdateRef.current) {
      restoreConfirmedSnapshot();
    }

    if (reconnect.getAttempt() === 0) {
      toast.error("There was a disconnect from the server. Reconnecting...");
    }

    const snapshot = latestMultiplayerSnapshotRef.current;
    const nextAuth = latestAuthRef.current;
    if (snapshot && nextAuth) {
      reconnect.schedule();
    }
  }, [logWebSocketDebug, restoreConfirmedSnapshot]);

  const sendMultiplayerMessage = useCallback(
    (message: ClientToServerMessage) => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        setMultiplayerError("Connection not ready.");
        return;
      }

      const currentSnapshot = latestMultiplayerSnapshotRef.current;
      if (currentSnapshot) {
        let nextState: GameState | null = null;

        switch (message.type) {
          case "place-piece": {
            const result = placePiece(currentSnapshot.state, message.position);
            if (!result.ok) {
              setMultiplayerError(result.reason);
              return;
            }
            nextState = result.value;
            break;
          }
          case "jump-piece": {
            const result = jumpPiece(currentSnapshot.state, message.from, message.to);
            if (!result.ok) {
              setMultiplayerError(result.reason);
              return;
            }
            nextState = result.value;
            break;
          }
          case "confirm-jump": {
            const result = confirmPendingJump(currentSnapshot.state);
            if (!result.ok) {
              setMultiplayerError(result.reason);
              return;
            }
            nextState = result.value;
            break;
          }
          case "undo-pending-jump-step": {
            const result = undoPendingJumpStep(currentSnapshot.state);
            if (!result.ok) {
              setMultiplayerError(result.reason);
              return;
            }
            nextState = result.value;
            break;
          }
          default:
            break;
        }

        if (nextState) {
          pendingOptimisticUpdateRef.current = true;
          const nextSnapshot = createOptimisticSnapshot(currentSnapshot, nextState);
          commitMultiplayerSnapshot(nextSnapshot, { confirmed: false });
          syncMultiplayerSelection(nextSnapshot);
        }
      }

      try {
        socket.send(JSON.stringify(message));
      } catch {
        if (socketRef.current === socket) {
          socketRef.current = null;
        }
        socket.close();
        handleUnexpectedMultiplayerDisconnect();
      }
    },
    [commitMultiplayerSnapshot, syncMultiplayerSelection, handleUnexpectedMultiplayerDisconnect],
  );

  const connectToRoom = useCallback(
    (
      snapshot: MultiplayerSnapshot,
      options: {
        preserveView?: boolean;
      } = {},
    ) => {
      if (options.preserveView) {
        reconnectRef.current.clear();
        const existingSocket = socketRef.current;
        socketRef.current = null;
        existingSocket?.close();
      }

      const socket = new WebSocket(buildWebSocketUrl(snapshot.gameId));
      logWebSocketDebug("connect", {
        url: buildWebSocketUrl(snapshot.gameId),
        preserveView: options.preserveView ?? false,
        gameId: snapshot.gameId,
      });

      socketRef.current = socket;
      setConnectionState("connecting");
      commitMultiplayerSnapshot(snapshot);
      syncMultiplayerSelection(snapshot);

      socket.addEventListener("open", () => {
        if (socketRef.current !== socket) {
          return;
        }
        reconnectRef.current.reset();
        setConnectionState("connected");
        logWebSocketDebug("open", {
          url: socket.url,
          gameId: snapshot.gameId,
        });
      });

      socket.addEventListener("message", (event) => {
        if (socketRef.current !== socket) {
          return;
        }

        const payload = JSON.parse(event.data as string) as ServerToClientMessage;

        if (payload.type === "snapshot") {
          logWebSocketDebug("snapshot", {
            gameId: payload.snapshot.gameId,
            status: payload.snapshot.status,
            historyLength: payload.snapshot.state.history.length,
          });
          commitMultiplayerSnapshot(payload.snapshot);
          syncMultiplayerSelection(payload.snapshot);
          setMultiplayerError(null);
          return;
        }

        if (payload.type === "rematch-started") {
          logWebSocketDebug("rematch-started", { gameId: payload.gameId });
          onRematchStartedRef.current?.(payload.gameId);
          return;
        }

        if (payload.type === "game-aborted") {
          logWebSocketDebug("game-aborted", {
            reason: payload.reason,
            requeuedForMatchmaking: payload.requeuedForMatchmaking,
          });
          onGameAbortedRef.current?.({
            reason: payload.reason,
            requeuedForMatchmaking: payload.requeuedForMatchmaking,
            timeControl: payload.timeControl,
          });
          return;
        }

        if (payload.type === "error") {
          logWebSocketDebug("server-error", {
            code: payload.code,
            message: payload.message,
          });

          if (pendingOptimisticUpdateRef.current) {
            restoreConfirmedSnapshot();
          }

          setMultiplayerError(payload.message);
        }
      });

      socket.addEventListener("close", (event) => {
        logWebSocketDebug("close", {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
          readyState: socket.readyState,
        });
        if (socketRef.current !== socket) {
          return;
        }
        socketRef.current = null;
        handleUnexpectedMultiplayerDisconnect();
      });

      socket.addEventListener("error", () => {
        logWebSocketDebug("error", {
          readyState: socket.readyState,
          url: socket.url,
        });
      });
    },
    [
      logWebSocketDebug,
      commitMultiplayerSnapshot,
      syncMultiplayerSelection,
      handleUnexpectedMultiplayerDisconnect,
      restoreConfirmedSnapshot,
    ],
  );

  const reconnectToCurrentRoom = useCallback(async () => {
    const snapshot = latestMultiplayerSnapshotRef.current;
    if (!snapshot) {
      return;
    }

    setConnectionState("connecting");
    logWebSocketDebug("reconnect-start", {
      gameId: snapshot.gameId,
      attempt: reconnectRef.current.getAttempt(),
    });

    try {
      const fetchGame = options.spectateOnly ? getMultiplayerGame : accessMultiplayerGame;
      const response = await fetchGame(snapshot.gameId);
      connectToRoom(response.snapshot, {
        preserveView: true,
      });
    } catch (error) {
      if (isNetworkError(error)) {
        setConnectionState("disconnected");
        reconnectRef.current.schedule();
        return;
      }
      setMultiplayerError(readableError(error));
    }
  }, [logWebSocketDebug, connectToRoom]);

  reconnectToCurrentRoomRef.current = reconnectToCurrentRoom;

  // When gameId changes (e.g. rematch navigation), close old socket and reset state
  // so the page's load effect can connect to the new game.
  const prevGameIdRef = useRef(gameId);
  useEffect(() => {
    if (prevGameIdRef.current !== gameId && prevGameIdRef.current !== null) {
      reconnectRef.current.clear();
      const socket = socketRef.current;
      socketRef.current = null;
      socket?.close();
      setConnectionState("idle");
      setMultiplayerSnapshot(null);
      setMultiplayerSelection(null);
      setMultiplayerError(null);
    }
    prevGameIdRef.current = gameId;
  }, [gameId]);

  useEffect(() => {
    return () => {
      reconnectRef.current.clear();
      const socket = socketRef.current;
      socketRef.current = null;
      socket?.close();
    };
  }, []);

  return {
    multiplayerSnapshot,
    multiplayerSelection,
    multiplayerError,
    setMultiplayerError,
    multiplayerBusy,
    setMultiplayerBusy,
    connectionState,
    connectToRoom,
    sendMultiplayerMessage,
    handleUnexpectedMultiplayerDisconnect,
    setMultiplayerSelection,
  };
}
