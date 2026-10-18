/**
 * Development server: `next dev` plus the API proxy.
 *
 * Proxies /api/* and /ws/* (HTTP and WebSocket) to the backend (API_URL,
 * else http://127.0.0.1:API_PORT), so the browser talks to one origin as it
 * does in production, where the Cloudflare zone sends those paths to the
 * game server and everything else is the static export.
 *
 * Production is not served from here: `pnpm build` writes the static site to
 * out/ (see scripts/finalize-web-export.mjs), and `pnpm start`
 * (serve-export.mjs) previews it the way Cloudflare serves it.
 *
 * Usage:
 *   node server.mjs              (PORT, handled by scripts/dev.mjs)
 */

import { createServer } from "node:http";
import next from "next";
import { createApiProxy } from "./runtime-proxy.mjs";

const port = Number.parseInt(process.env.PORT || "3000", 10);
const apiTarget = process.env.API_URL || `http://127.0.0.1:${process.env.API_PORT || "5005"}`;
const apiProxy = createApiProxy(apiTarget);

// Bundler selection.
//
// Default is Next 16's default (Turbopack). Setting NEXT_DEV_BUNDLER
// to `webpack` or `turbopack` forces that choice — useful for
// A/B-testing cold-compile time if Turbopack regresses in a future
// Next version.
//
// Measured on the current tree (commit 0366f295, first cold compile
// of /matchmaking from a freshly wiped .next dir):
//   Turbopack:  ~18 s compile + ~5 s boot = ~23 s total
//   webpack:    ~81 s compile + ~33 s boot = ~114 s total
// Turbopack is 4–5× faster here, so the default is correct. If you
// see this flipping in a future Next version, re-measure via
// `node scripts/measure-cold-compile.mjs /matchmaking` before
// swapping.
const bundlerChoice = process.env.NEXT_DEV_BUNDLER;
const nextOptions = { dev: true, port };
if (bundlerChoice === "webpack") {
  nextOptions.webpack = true;
} else if (bundlerChoice === "turbopack") {
  nextOptions.turbopack = true;
}
const app = next(nextOptions);
const handle = app.getRequestHandler();

await app.prepare();

console.log(`> API proxy target: ${new URL(apiTarget).origin}`);

const isApiPath = (pathname) =>
  pathname.startsWith("/api/") || pathname === "/ws" || pathname.startsWith("/ws/");

const httpServer = createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  if (isApiPath(pathname)) {
    apiProxy.http(req, res);
    return;
  }
  handle(req, res);
});

// Proxy WebSocket upgrade requests to the backend
httpServer.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  if (isApiPath(pathname)) {
    apiProxy.upgrade(req, socket, head);
    return;
  }
  // Not an API WebSocket — let Next.js HMR handle it
});

httpServer.listen(port, () => {
  console.log(`> Next.js ready on http://localhost:${port} (dev)`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, async () => {
    httpServer.closeAllConnections();
    await apiProxy.close();
    await app.close();
    process.exit(0);
  });
}
