import { createServer } from "http";
import WebSocket, { WebSocketServer } from "ws";
import app from "./app";
import { FRONTEND_URL, PORT } from "./config/envVars";
import { connectToDB, disconnectFromDB } from "./db";
import { gameService, GameServiceError } from "./game/gameService";
import { getPlayerFromUpgradeRequest } from "./game/playerTokens";
import { ClientToServerMessage } from "../shared/src";

const server = createServer(app);
const websocketServer = new WebSocketServer({ server });
const WEBSOCKET_PATHS = new Set(["/", "/ws", "/api/ws", "/api/ws/lobby"]);
const SOCKET_PING_INTERVAL_MS = 1000 * 10;

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  if (!FRONTEND_URL) return true; // dev mode — allow all
  try {
    const allowed = new URL(FRONTEND_URL).origin;
    const incoming = new URL(origin).origin;
    if (incoming === allowed) return true;
    // Allow any localhost origin in development (e2e tests use a different port)
    if (incoming.match(/^https?:\/\/localhost(:\d+)?$/) && allowed.includes("localhost")) return true;
    return false;
  } catch {
    return false;
  }
}

function sendJson(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

websocketServer.on("connection", (socket, request) => {
  let isAlive = true;
  const baseUrl = `http://${request.headers.host || "localhost"}`;
  const url = new URL(request.url || "/ws", baseUrl);
  const gameId = url.searchParams.get("gameId")?.trim().toUpperCase();

  console.info(`[ws] incoming connection: ${url.pathname}${gameId ? `?gameId=${gameId}` : ""}`);

  const pingInterval = setInterval(() => {
    if (!isAlive) {
      console.warn(`[ws] client ${gameId || "unknown"} failed to respond to ping, terminating.`);
      return socket.terminate();
    }

    isAlive = false;
    if (socket.readyState === WebSocket.OPEN) {
      socket.ping();
    }
  }, SOCKET_PING_INTERVAL_MS);

  socket.on("pong", () => {
    isAlive = true;
  });

  socket.on("close", (code, reason) => {
    clearInterval(pingInterval);
    console.info(`[ws] closed ${gameId || "unknown"}: code=${code}, reason=${reason.toString() || "none"}`);
    void gameService.disconnect(socket);
  });

  socket.on("error", (error) => {
    clearInterval(pingInterval);
    console.error(`[ws] error ${gameId || "unknown"}:`, error);
    void gameService.disconnect(socket);
  });

  void (async () => {
    if (!isAllowedOrigin(request.headers.origin)) {
      console.warn(`[ws] rejected connection from disallowed origin: ${request.headers.origin}`);
      socket.close();
      return;
    }

    if (!WEBSOCKET_PATHS.has(url.pathname)) {
      console.warn(`[ws] invalid path rejected: ${url.pathname} (gameId: ${gameId || "none"})`);
      socket.close();
      return;
    }

    if (url.pathname === "/api/ws/lobby") {
      const player = await getPlayerFromUpgradeRequest(request);
      if (!player || player.kind !== "account") {
        console.warn(`[ws] unauthorized lobby connection attempt`);
        socket.close();
        return;
      }

      await gameService.connectLobby(player, socket);
      return;
    }

    if (!gameId || !/^[A-Z2-9]{6}$/.test(gameId)) {
      sendJson(socket, {
        type: "error",
        code: "BAD_CONNECTION",
        message: "A valid 6-character game ID is required to connect.",
      });
      socket.close();
      return;
    }

    const player = await getPlayerFromUpgradeRequest(request);
    if (!player) {
      console.warn(`[ws] unauthorized connection attempt for ${gameId}`);
      sendJson(socket, {
        type: "error",
        code: "UNAUTHORIZED",
        message: "That player session is missing or has expired.",
      });
      socket.close();
      return;
    }

    await gameService.connect(gameId, player, socket).catch((error) => {
      const serviceError =
        error instanceof GameServiceError
          ? error
          : new GameServiceError(
              500,
              "WS_CONNECT_FAILED",
              "Unable to connect to that multiplayer room."
            );

      console.error(`[ws] gameService.connect failed for ${gameId}:`, serviceError);
      sendJson(socket, {
        type: "error",
        code: serviceError.code,
        message: serviceError.message,
      });
      socket.close();
    });

    socket.on("message", (rawMessage) => {
      void (async () => {
        try {
          const message = JSON.parse(rawMessage.toString()) as ClientToServerMessage;
          await gameService.applyAction(gameId, player, message);
        } catch (error) {
          const serviceError =
            error instanceof GameServiceError
              ? error
              : new GameServiceError(
                  400,
                  "INVALID_MESSAGE",
                  "That move update could not be processed."
                );

          sendJson(socket, {
            type: "error",
            code: serviceError.code,
            message: serviceError.message,
          });
        }
      })();
    });
  })().catch((error) => {
    console.error(`[ws] fatal error in connection handler for ${gameId}:`, error);
    sendJson(socket, {
      type: "error",
      code: "UNAUTHORIZED",
      message: "Unable to validate that player session right now.",
    });
    socket.close();
  });
});

const pruneHandle = setInterval(() => {
  gameService.pruneInactiveRooms(1000 * 60 * 60 * 24);
}, 1000 * 60 * 30);

pruneHandle.unref();

let isShuttingDown = false;

function closeHttpServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        if ("code" in error && error.code === "ERR_SERVER_NOT_RUNNING") {
          resolve();
          return;
        }

        reject(error);
        return;
      }

      resolve();
    });
  });
}

function closeWebSocketServer(): Promise<void> {
  return new Promise((resolve) => {
    websocketServer.close(() => resolve());
  });
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.info(`${signal} received. Closing multiplayer server.`);

  clearInterval(pruneHandle);

  for (const client of websocketServer.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.close(1001, "Server shutting down");
    }
  }

  const forceExitTimer = setTimeout(() => {
    process.exit(1);
  }, 1000 * 10);
  forceExitTimer.unref();

  try {
    await closeWebSocketServer();
    await closeHttpServer();
    await disconnectFromDB();
    clearTimeout(forceExitTimer);
    process.exit(0);
  } catch (error) {
    console.error("Error while shutting down cleanly:", error);
    clearTimeout(forceExitTimer);
    process.exit(1);
  }
}

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

async function start(): Promise<void> {
  try {
    await connectToDB();

    server.listen(PORT, () => {
      console.info(`Tiao server listening on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start Tiao server:", error);
    process.exit(1);
  }
}

void start();
