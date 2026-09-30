import "./lib/glitchtip"; // Must be early — hooks uncaughtException/unhandledRejection
import { installCrashGuard } from "./lib/crashGuard";

// Must run before anything else that can throw so the net is in place
// from the first async tick. See lib/crashGuard.ts for the rationale —
// TL;DR: keep the server up for the other 99 in-flight players when one
// handler blows up.
installCrashGuard();

import { createServer } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import type { ClientToServerMessage } from "../shared/src";
import app from "./app";
import { verifySessionToken } from "./auth/desktopSessionManager";
import { getPlayerFromUpgradeRequest } from "./auth/sessionHelper";
import { PORT } from "./config/envVars";
import { getRedisClient } from "./config/redisClient";
import { connectToDB, disconnectFromDB } from "./db";
import { type DailyJobScheduler, startDiscordLeaderboardJob } from "./discord/leaderboardJob";
import { GameServiceError, gameService } from "./game/gameService";
import { createLogger } from "./lib/logger";
import { isAllowedOrigin } from "./lib/wsOrigin";

const log = createLogger("ws");
const serverLog = createLogger("http");

const server = createServer(app);
const websocketServer = new WebSocketServer({ server });
const WEBSOCKET_PATHS = new Set(["/", "/ws", "/api/ws", "/api/ws/lobby"]);
const SOCKET_PING_INTERVAL_MS = 1000 * 10;

// ─── WebSocket upgrade rate limit ────────────────────────────────────
//
// In-memory fixed-window counter per source IP. This is per-instance by
// design — for DoS prevention a per-instance bucket is fine (an attacker
// hitting all instances uniformly is bounded by load-balancer capacity
// anyway, and an attacker hitting one instance gets throttled here).
//
// The limit is intentionally generous: a legitimate user with a few tabs
// open and a flaky connection might legitimately reconnect several times
// a minute. 120 upgrades/minute/IP gives us ~2/s which is well below any
// flood but far above normal usage.
//
// Tests bypass the limiter entirely (NODE_ENV=test).

const WS_UPGRADES_PER_MINUTE = 120;
const WS_RATE_WINDOW_MS = 60_000;
const wsUpgradeCounts = new Map<string, number>();
const wsRateLimitEnabled = process.env.NODE_ENV !== "test";

const wsRateWindowTimer = setInterval(() => wsUpgradeCounts.clear(), WS_RATE_WINDOW_MS);
wsRateWindowTimer.unref();

function checkWsUpgradeRate(ip: string): boolean {
  if (!wsRateLimitEnabled) return true;
  const next = (wsUpgradeCounts.get(ip) ?? 0) + 1;
  wsUpgradeCounts.set(ip, next);
  return next <= WS_UPGRADES_PER_MINUTE;
}

// ─── Server-level error listeners ────────────────────────────────────
//
// Without these, an error emitted on the HTTP server or the WebSocket
// server object (not a specific socket) bubbles up as an unhandled
// `error` event and crashes the process. The crash guard would catch
// an uncaughtException but not an EventEmitter error thrown from a
// synchronous event listener path — so we catch them here explicitly.
//
// - `server.on("error")` fires on listen failures (EADDRINUSE, etc.)
//   and some low-level socket accept errors.
// - `server.on("clientError")` fires when a connecting client sends a
//   malformed HTTP request before any route handler exists.
// - `websocketServer.on("error")` fires on WebSocket-level issues that
//   aren't tied to a specific `ws` client (protocol errors during
//   upgrade, handshake failures, etc.).

server.on("error", (err: Error) => {
  serverLog.error("http server error", err);
});

server.on("clientError", (err: Error, socket) => {
  serverLog.warn("http client error", { message: err.message });
  try {
    socket.destroy();
  } catch {
    /* already torn down */
  }
});

websocketServer.on("error", (err: Error) => {
  log.error("websocket server error", err);
});

// Note: isAllowedOrigin is imported from ./lib/wsOrigin — extracted to
// its own module for unit testability and so the desktop token
// exception (commit 2 of desktop-electron-phase3a) can branch on the
// { hasValidDesktopToken } option without bloating this file.

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

  // Rate-limit upgrades per source IP. The handshake already completed
  // at this point (ws library auto-handles upgrades when attached to the
  // http server), but closing immediately is still far cheaper than
  // letting a flood of idle sockets pile up in `lobbyConnections` or
  // hold references to player identities. For a real DoS-hardened
  // setup you'd want to reject before the handshake via
  // `noServer: true` + manual `server.on("upgrade")`; this is the
  // smaller, lower-risk first pass.
  const remoteIp =
    (request.headers["x-forwarded-for"]?.toString().split(",")[0].trim() ?? "") ||
    request.socket.remoteAddress ||
    "unknown";
  if (!checkWsUpgradeRate(remoteIp)) {
    log.warn("upgrade rate limit exceeded", { ip: remoteIp });
    socket.close(1008, "rate limit");
    return;
  }

  // Desktop clients authenticate via ?token=<bearer> in the URL
  // because browser WebSocket APIs can't set custom headers.  Validate
  // the token against the revocable session store here so we
  // know whether to accept the app:// origin AND so the downstream
  // getPlayerFromUpgradeRequest can skip re-parsing the query string.
  const tokenQueryParam = url.searchParams.get("token");

  log.info("incoming connection", { path: url.pathname, gameId: gameId ?? null });

  let checkingDesktopSession = false;
  const pingInterval = setInterval(() => {
    if (tokenQueryParam && !checkingDesktopSession) {
      checkingDesktopSession = true;
      void verifySessionToken(tokenQueryParam)
        .then((payload) => {
          if (!payload) socket.close(1008, "session expired");
        })
        .finally(() => {
          checkingDesktopSession = false;
        });
    }
    if (!isAlive) {
      log.warn("client failed to respond to ping, terminating", {
        gameId: gameId ?? "unknown",
      });
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
    log.info("closed", {
      gameId: gameId ?? "unknown",
      code,
      reason: reason.toString() || "none",
    });
    void gameService.disconnect(socket);
  });

  socket.on("error", (error) => {
    clearInterval(pingInterval);
    log.error("socket error", error, { gameId: gameId ?? "unknown" });
    void gameService.disconnect(socket);
  });

  void (async () => {
    const bearerPayload = tokenQueryParam ? await verifySessionToken(tokenQueryParam) : null;
    const bearerUserId = bearerPayload?.userId ?? null;
    if (socket.readyState !== WebSocket.OPEN) return;
    if (!isAllowedOrigin(request.headers.origin, { hasValidDesktopToken: bearerUserId !== null })) {
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
      const player = await getPlayerFromUpgradeRequest(request, { bearerUserId });
      if (!player) {
        console.warn(`[ws] unauthorized lobby connection attempt`);
        socket.close();
        return;
      }

      // Guests are allowed on the lobby socket so that matchmaking can use
      // socket lifetime for queue cleanup. They receive game-updates for their
      // own games and no-op social updates.
      await gameService.connectLobby(
        player,
        socket,
        tokenQueryParam ? async () => !!(await verifySessionToken(tokenQueryParam)) : undefined,
      );
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

    const player = await getPlayerFromUpgradeRequest(request, { bearerUserId });
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
              "Unable to connect to that multiplayer room.",
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
          if (tokenQueryParam && !(await verifySessionToken(tokenQueryParam))) {
            socket.close(1008, "session expired");
            return;
          }
          const message = JSON.parse(rawMessage.toString()) as ClientToServerMessage;
          await gameService.applyAction(gameId, player, message);
        } catch (error) {
          const serviceError =
            error instanceof GameServiceError
              ? error
              : new GameServiceError(
                  400,
                  "INVALID_MESSAGE",
                  "That move update could not be processed.",
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

const pruneHandle = setInterval(
  () => {
    gameService.pruneInactiveRooms(1000 * 60 * 60 * 24);
  },
  1000 * 60 * 30,
);

pruneHandle.unref();

gameService.startMatchmakingSweep();

// Armed after the DB connects (see start()) — no-op unless DISCORD_* is set.
let discordLeaderboardJob: DailyJobScheduler | null = null;

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
    await discordLeaderboardJob?.close();
    await gameService.close();
    await closeWebSocketServer();
    await closeHttpServer();
    await disconnectFromDB();
    const { flush: flushGlitchtip } = await import("./lib/glitchtip");
    await flushGlitchtip();
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

    // Restore in-memory clock timers for active timed games (lost on restart)
    await gameService.restoreClockTimers();

    discordLeaderboardJob = startDiscordLeaderboardJob(getRedisClient());

    server.listen(PORT, () => {
      console.info(`Tiao server listening on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start Tiao server:", error);
    process.exit(1);
  }
}

void start();
