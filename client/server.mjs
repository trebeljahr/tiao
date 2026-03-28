/**
 * Custom Next.js server with runtime API proxying.
 *
 * Proxies /api/* and /ws/* to the backend at runtime using API_URL,
 * so the Docker image doesn't need to be rebuilt when the backend
 * address changes.
 *
 * Usage:
 *   node server.mjs              (production: PORT)
 *   node server.mjs              (dev: PORT, handled by dev.mjs)
 */

import { createServer, request as httpRequest } from "http";
import { request as httpsRequest } from "https";
import { parse } from "url";
import next from "next";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000", 10);
const apiTarget = process.env.API_URL || `http://127.0.0.1:${process.env.API_PORT || "5005"}`;
const apiUrl = new URL(apiTarget);
const isHttps = apiUrl.protocol === "https:";
const makeRequest = isHttps ? httpsRequest : httpRequest;

function proxyRequest(req, res) {
  const proxyReq = makeRequest(
    {
      hostname: apiUrl.hostname,
      port: apiUrl.port || (isHttps ? 443 : 80),
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: apiUrl.host },
    },
    (proxyRes) => {
      // Follow redirects that point to the API domain back through the proxy
      if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
        const loc = proxyRes.headers.location;
        // Rewrite redirects from the API back to the client origin
        if (loc.startsWith(apiTarget)) {
          proxyRes.headers.location = loc.replace(apiTarget, "");
        }
      }
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    },
  );

  proxyReq.on("error", (err) => {
    console.error(`Failed to proxy ${req.url}`, err);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Bad Gateway" }));
    }
  });

  req.pipe(proxyReq, { end: true });
}

const app = next({ dev });
const handle = app.getRequestHandler();

await app.prepare();

console.log(`> API proxy target: ${apiTarget}`);

createServer((req, res) => {
  const { pathname } = parse(req.url, true);

  if (pathname.startsWith("/api/") || pathname.startsWith("/ws/")) {
    proxyRequest(req, res);
    return;
  }

  handle(req, res, parse(req.url, true));
}).listen(port, () => {
  console.log(
    `> Next.js ready on http://localhost:${port} (${dev ? "dev" : "production"})`,
  );
});
