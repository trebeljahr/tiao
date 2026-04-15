/**
 * Custom Next.js server with runtime API proxying.
 *
 * Proxies:
 *   /api/* and /ws/*  → backend (API_URL)
 *   /collect/*        → OpenPanel analytics (OPENPANEL_PROXY_URL)
 *   /bugs             → GlitchTip/Sentry envelope ingestion (GLITCHTIP_PROXY_URL)
 *
 * The analytics and error-monitoring proxies exist so that browser
 * requests look like first-party traffic. Ad-blockers and privacy
 * extensions block direct requests to analytics-*.example.com or
 * sentry/glitchtip domains; routing through the same origin avoids that.
 *
 * Usage:
 *   node server.mjs              (production: PORT)
 *   node server.mjs              (dev: PORT, handled by dev.mjs)
 */

import { createServer, request as httpRequest } from "http";
import { request as httpsRequest } from "https";
import { existsSync, statSync, createReadStream } from "fs";
import { join, extname, resolve } from "path";
import next from "next";

const MIME_TYPES = {
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".webm": "video/webm",
};

const publicDir = resolve("./public");

/**
 * Try to serve a static file from the public directory.
 * Returns true if the file was served, false otherwise.
 */
export function servePublicFile(req, res, pathname) {
  // Decode URI-encoded characters (e.g. %20 -> space)
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return false;
  }

  // Resolve the full path and prevent path traversal
  const filePath = resolve(join(publicDir, decodedPath));
  if (!filePath.startsWith(publicDir + "/")) {
    return false;
  }

  // Check if file exists and is a regular file
  if (!existsSync(filePath)) {
    return false;
  }
  const stat = statSync(filePath);
  if (!stat.isFile()) {
    return false;
  }

  const ext = extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  // Binary formats (audio, images, video) are already compressed.
  // Omit Content-Length for these so Node uses chunked transfer encoding —
  // otherwise Cloudflare gzip-compresses the body but forwards the original
  // Content-Length, causing ERR_CONTENT_DECODING_FAILED in browsers.
  // no-transform is also set as a hint, though Cloudflare ignores it.
  const binaryExts = new Set([".mp3", ".jpeg", ".jpg", ".png", ".webp", ".webm", ".ico"]);
  const isBinary = binaryExts.has(ext);

  const headers = {
    "Content-Type": contentType,
    "Cache-Control": isBinary
      ? "public, max-age=31536000, immutable, no-transform"
      : "public, max-age=31536000, immutable",
  };
  if (!isBinary) {
    headers["Content-Length"] = stat.size;
  }

  res.writeHead(200, headers);
  createReadStream(filePath).pipe(res);
  return true;
}

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000", 10);
const apiTarget = process.env.API_URL || `http://127.0.0.1:${process.env.API_PORT || "5005"}`;
const apiUrl = new URL(apiTarget);
const isHttps = apiUrl.protocol === "https:";
const makeRequest = isHttps ? httpsRequest : httpRequest;

// --- OpenPanel analytics proxy -----------------------------------------------
// When set, /collect/* requests are forwarded to the OpenPanel API so that
// browser analytics traffic looks like a first-party request (invisible to
// adblockers). The client SDK is configured with apiUrl="/collect" instead of
// the direct analytics-api.* domain.
const openpanelProxyTarget = process.env.OPENPANEL_PROXY_URL; // e.g. "https://analytics-api.trebeljahr.com"
const openpanelUrl = openpanelProxyTarget ? new URL(openpanelProxyTarget) : null;

// --- GlitchTip (Sentry) tunnel proxy ----------------------------------------
// When set, /bugs receives Sentry envelopes from the browser SDK (via its
// `tunnel` option) and forwards them to the GlitchTip ingestion endpoint.
// The DSN's project ID is extracted from the envelope header at runtime so
// the proxy doesn't need to know the DSN itself.
const glitchtipProxyTarget = process.env.GLITCHTIP_PROXY_URL; // e.g. "https://glitchtip.trebeljahr.com"
const glitchtipUrl = glitchtipProxyTarget ? new URL(glitchtipProxyTarget) : null;

/**
 * Generic reverse proxy for a single request. Sends the request to the
 * given target URL, rewriting Host and path as needed.
 */
function proxyToTarget(req, res, target, targetPath) {
  const targetIsHttps = target.protocol === "https:";
  const doRequest = targetIsHttps ? httpsRequest : httpRequest;

  const proxyReq = doRequest(
    {
      hostname: target.hostname,
      port: target.port || (targetIsHttps ? 443 : 80),
      path: targetPath,
      method: req.method,
      headers: { ...req.headers, host: target.host },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    },
  );

  proxyReq.on("error", (err) => {
    console.error(`Failed to proxy ${req.url} → ${target.origin}${targetPath}`, err);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Bad Gateway" }));
    }
  });

  req.pipe(proxyReq, { end: true });
}

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

function proxyWebSocketUpgrade(req, socket, head) {
  const proxyReq = makeRequest({
    hostname: apiUrl.hostname,
    port: apiUrl.port || (isHttps ? 443 : 80),
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: apiUrl.host },
  });

  proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
    // Forward the 101 Switching Protocols response to the client
    const responseLines = [`HTTP/1.1 101 ${proxyRes.statusMessage || "Switching Protocols"}`];
    for (const [key, value] of Object.entries(proxyRes.headers)) {
      if (Array.isArray(value)) {
        for (const v of value) responseLines.push(`${key}: ${v}`);
      } else if (value != null) {
        responseLines.push(`${key}: ${value}`);
      }
    }
    socket.write(responseLines.join("\r\n") + "\r\n\r\n");

    // Forward any buffered data from the upgrade handshake
    if (proxyHead.length) socket.write(proxyHead);
    if (head.length) proxySocket.write(head);

    // Bidirectional pipe between client and backend sockets
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);

    proxySocket.on("error", () => socket.destroy());
    socket.on("error", () => proxySocket.destroy());
    proxySocket.on("end", () => socket.end());
    socket.on("end", () => proxySocket.end());
  });

  // Backend rejected the upgrade with a normal HTTP response
  proxyReq.on("response", (proxyRes) => {
    const responseLines = [`HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage}`];
    for (const [key, value] of Object.entries(proxyRes.headers)) {
      if (Array.isArray(value)) {
        for (const v of value) responseLines.push(`${key}: ${v}`);
      } else if (value != null) {
        responseLines.push(`${key}: ${value}`);
      }
    }
    socket.write(responseLines.join("\r\n") + "\r\n\r\n");
    proxyRes.pipe(socket);
  });

  proxyReq.on("error", (err) => {
    console.error(`Failed to proxy WebSocket upgrade ${req.url}`, err);
    socket.destroy();
  });

  proxyReq.end();
}

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
const nextOptions = { dev, port };
if (bundlerChoice === "webpack") {
  nextOptions.webpack = true;
} else if (bundlerChoice === "turbopack") {
  nextOptions.turbopack = true;
}
const app = next(nextOptions);
const handle = app.getRequestHandler();

await app.prepare();

console.log(`> API proxy target: ${apiTarget}`);
if (openpanelProxyTarget) console.log(`> Analytics proxy: /collect → ${openpanelProxyTarget}`);
if (glitchtipProxyTarget) console.log(`> Error tunnel: /bugs → ${glitchtipProxyTarget}`);

const httpServer = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws/")) {
    proxyRequest(req, res);
    return;
  }

  // OpenPanel analytics proxy: /collect/* → OPENPANEL_PROXY_URL/*
  if (openpanelUrl && url.pathname.startsWith("/collect")) {
    const targetPath = url.pathname.replace(/^\/collect/, "") + url.search;
    proxyToTarget(req, res, openpanelUrl, targetPath || "/");
    return;
  }

  // GlitchTip/Sentry tunnel: /bugs receives envelope POST from the Sentry
  // SDK and forwards to the real ingestion endpoint. The envelope header's
  // first line contains the DSN, from which we extract the project ID.
  if (glitchtipUrl && url.pathname === "/bugs") {
    // Buffer the body to parse the envelope header and extract the project ID.
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      try {
        const header = JSON.parse(body.toString().split("\n")[0]);
        const dsnUrl = new URL(header.dsn);
        const projectId = dsnUrl.pathname.replace(/^\//, "");
        const targetPath = `/api/${projectId}/envelope/`;
        proxyToTarget(
          // Wrap the buffered body as a readable-like object for proxyToTarget.
          // We override pipe to write the already-buffered body directly.
          {
            ...req,
            pipe: (dest, opts) => {
              dest.write(body);
              if (opts?.end !== false) dest.end();
            },
          },
          res,
          glitchtipUrl,
          targetPath,
        );
      } catch (err) {
        console.error("[bugs tunnel] Failed to parse envelope header:", err);
        if (!res.headersSent) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Bad envelope" }));
        }
      }
    });
    return;
  }

  // Serve static files from public/ directly (fixes Docker path mismatch)
  if (servePublicFile(req, res, url.pathname)) {
    return;
  }

  handle(req, res);
});

// Proxy WebSocket upgrade requests to the backend
httpServer.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  if (pathname.startsWith("/api/") || pathname.startsWith("/ws/")) {
    proxyWebSocketUpgrade(req, socket, head);
    return;
  }

  // Not an API WebSocket — let Next.js HMR handle it
});

httpServer.listen(port, () => {
  console.log(`> Next.js ready on http://localhost:${port} (${dev ? "dev" : "production"})`);
});
