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
import { parse } from "url";
import next from "next";
import httpProxy from "http-proxy";
const { createProxyServer } = httpProxy;

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000", 10);
const apiTarget =
  process.env.API_URL ||
  `http://127.0.0.1:${process.env.API_PORT || "5005"}`;

const app = next({ dev });
const handle = app.getRequestHandler();

const proxy = createProxyServer({ target: apiTarget, ws: true });

proxy.on("error", (err, _req, res) => {
  console.warn(`[ws-proxy] ${err.code ?? err.message}`);
  if (res && "writeHead" in res && !res.headersSent) {
    res.writeHead(502);
    res.end();
  }
});

await app.prepare();

const server = createServer((req, res) => {
  handle(req, res, parse(req.url, true));
});

server.on("upgrade", (req, socket, head) => {
  const { pathname } = parse(req.url, true);
  if (
    pathname === "/api/ws" ||
    pathname === "/api/ws/lobby" ||
    pathname === "/ws" ||
    pathname?.startsWith("/api/ws/")
  ) {
    proxy.ws(req, socket, head);
  }
});

server.listen(port, () => {
  console.log(`> Next.js ready on http://localhost:${port} (${dev ? "dev" : "production"})`);
});
