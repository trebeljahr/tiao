/**
 * Custom Next.js dev/production server that proxies WebSocket upgrade
 * requests to the backend API server. This is needed because Next.js
 * rewrites only handle HTTP, not WebSocket upgrades.
 *
 * Usage:
 *   node server.mjs              (production: PORT, API_URL)
 *   node server.mjs              (dev: PORT, API_PORT, handled by dev.mjs)
 */

import { createServer } from "http";
import { connect as netConnect } from "net";
import { parse } from "url";
import next from "next";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000", 10);
const apiTarget =
  process.env.API_URL ||
  `http://127.0.0.1:${process.env.API_PORT || "5005"}`;
const apiUrl = new URL(apiTarget);

const app = next({ dev });
const handle = app.getRequestHandler();

await app.prepare();

const server = createServer((req, res) => {
  handle(req, res, parse(req.url, true));
});

// Raw TCP tunnel for WebSocket upgrades — forwards exact bytes with zero
// HTTP-level parsing so the browser ↔ backend WebSocket handshake and
// framing are never touched by the proxy.
server.on("upgrade", (req, socket, head) => {
  const { pathname } = parse(req.url, true);
  if (
    pathname === "/api/ws" ||
    pathname === "/api/ws/lobby" ||
    pathname === "/ws" ||
    pathname?.startsWith("/api/ws/")
  ) {
    const backend = netConnect(
      { host: apiUrl.hostname, port: Number(apiUrl.port) },
      () => {
        // Reconstruct the raw HTTP upgrade request using original header casing
        let raw = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
        }
        raw += "\r\n";

        backend.write(raw);
        if (head.length) backend.write(head);

        // Transparent bidirectional pipe — every byte flows as-is
        backend.pipe(socket);
        socket.pipe(backend);
      },
    );

    backend.on("error", (err) => {
      console.warn(`[ws-proxy] ${err.code ?? err.message}`);
      socket.destroy();
    });
    socket.on("error", () => backend.destroy());
    socket.on("close", () => backend.destroy());
    backend.on("close", () => socket.destroy());
  }
});

server.listen(port, () => {
  console.log(
    `> Next.js ready on http://localhost:${port} (${dev ? "dev" : "production"})`,
  );
});
