// Serve an existing Tiao web export with its real API proxy, loopback only.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { createApiProxy } from "../client/runtime-proxy.mjs";

const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port < 49152 || port > 65535) throw Error("Expected a high QA port");
const root = resolve(process.env.TIAO_QA_WEB_EXPORT);
const proxy = createApiProxy(`http://127.0.0.1:${process.env.API_PORT}`);
const mime = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".txt": "text/plain",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (pathname.startsWith("/api/")) return proxy.http(req, res);
    if (/^\/en(?:\/|$)/.test(pathname)) {
      res.writeHead(307, { location: pathname.slice(3) || "/" });
      res.end();
      return;
    }
    const base = resolve(root, "." + pathname);
    if (base !== root && !base.startsWith(root + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const candidates =
      req.headers.rsc === "1"
        ? [base, base + ".txt"]
        : [base, base + ".html", resolve(base, "index.html")];
    for (const file of candidates) {
      try {
        if (!(await stat(file)).isFile()) continue;
        res.writeHead(200, {
          "Content-Type": mime[extname(file)] || "application/octet-stream",
          "Cache-Control": "no-store",
        });
        createReadStream(file).pipe(res);
        return;
      } catch {
        /* Try next static-export shape. */
      }
    }
    res.writeHead(404);
    res.end("Not found");
  } catch {
    res.writeHead(400);
    res.end("Invalid path");
  }
});
server.on("upgrade", (req, socket, head) => {
  if (req.url?.startsWith("/api/") || req.url?.startsWith("/ws")) proxy.upgrade(req, socket, head);
  else socket.destroy();
});
server.listen(port, "127.0.0.1");
async function stop() {
  server.closeAllConnections();
  await proxy.close();
  server.close(() => process.exit(0));
}
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
