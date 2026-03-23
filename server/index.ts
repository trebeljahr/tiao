import { createServer } from "http";
import WebSocket, { WebSocketServer } from "ws";
import app from "./app";
import { PORT } from "./config/envVars";
import { gameService, GameServiceError } from "./game/gameService";
import { verifyPlayerToken } from "./game/playerTokens";
import { ClientToServerMessage } from "../shared/src";

const server = createServer(app);
const websocketServer = new WebSocketServer({ server, path: "/ws" });

function sendJson(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

websocketServer.on("connection", (socket, request) => {
  const baseUrl = `http://${request.headers.host || "localhost"}`;
  const url = new URL(request.url || "/ws", baseUrl);
  const gameId = url.searchParams.get("gameId")?.trim().toUpperCase();
  const token = url.searchParams.get("token");

  if (!gameId || !token) {
    sendJson(socket, {
      type: "error",
      code: "BAD_CONNECTION",
      message: "A gameId and token are required to connect.",
    });
    socket.close();
    return;
  }

  const player = verifyPlayerToken(token);
  if (!player) {
    sendJson(socket, {
      type: "error",
      code: "UNAUTHORIZED",
      message: "That player token is invalid or has expired.",
    });
    socket.close();
    return;
  }

  try {
    gameService.connect(gameId, player, socket);
  } catch (error) {
    const serviceError =
      error instanceof GameServiceError
        ? error
        : new GameServiceError(
            500,
            "WS_CONNECT_FAILED",
            "Unable to connect to that multiplayer room."
          );

    sendJson(socket, {
      type: "error",
      code: serviceError.code,
      message: serviceError.message,
    });
    socket.close();
    return;
  }

  socket.on("message", (rawMessage) => {
    try {
      const message = JSON.parse(rawMessage.toString()) as ClientToServerMessage;
      gameService.applyAction(gameId, player, message);
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
  });

  socket.on("close", () => {
    gameService.disconnect(socket);
  });

  socket.on("error", () => {
    gameService.disconnect(socket);
  });
});

const pruneHandle = setInterval(() => {
  gameService.pruneInactiveRooms(1000 * 60 * 60 * 24);
}, 1000 * 60 * 30);

pruneHandle.unref();

server.listen(PORT, () => {
  console.debug(`Server listening on http://localhost:${PORT}`);
});
