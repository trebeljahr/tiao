/**
 * Custom Next.js server with runtime API proxying.
 *
 * Proxies /api/* and /ws/* to the backend at runtime using API_URL,
 * including WebSocket upgrade requests, so the Docker image doesn't
 * need to be rebuilt when the backend address changes.
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

  // Binary formats (audio, images, video) are already compressed — adding
  // no-transform prevents Cloudflare from gzip-compressing them, which
  // causes ERR_CONTENT_DECODING_FAILED when Content-Length mismatches.
  const binaryExts = new Set([".mp3", ".jpeg", ".jpg", ".png", ".webp", ".webm", ".ico"]);
  const cacheControl = binaryExts.has(ext)
    ? "public, max-age=31536000, immutable, no-transform"
    : "public, max-age=31536000, immutable";

  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": stat.size,
    "Cache-Control": cacheControl,
  });
  createReadStream(filePath).pipe(res);
  return true;
}

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

const app = next({ dev });
const handle = app.getRequestHandler();

await app.prepare();

console.log(`> API proxy target: ${apiTarget}`);

const httpServer = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws/")) {
    proxyRequest(req, res);
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
