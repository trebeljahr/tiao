#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
// Read-only local preview of an existing web export for trailer capture.
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

const root = resolve(process.argv[2]);
const types = {
  ".html": "text/html",
  ".txt": "text/plain",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".json": "application/json",
};
const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    path = path.replace(
      /^\/(game|tournament|profile)\/([^/]+)/,
      (_, type, id) => `/${type}/__spa__${id.endsWith(".txt") ? ".txt" : ""}`,
    );
    if (path === "/") path = "/index.html";
    let file = resolve(root, `.${path}`);
    if (!file.startsWith(root + sep)) throw new Error("Invalid path");
    if (!extname(file)) file += ".html";
    await stat(file);
    res.writeHead(200, {
      "Content-Type": types[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});
server.listen(Number(process.argv[3] || 0), "127.0.0.1", () =>
  console.log(`http://127.0.0.1:${server.address().port}`),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => server.close(() => process.exit(0)));
