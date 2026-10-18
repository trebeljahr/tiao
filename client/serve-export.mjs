/**
 * Serves the finished web export (out/) the way playtiao.com does.
 *
 * In production the Cloudflare zone routes `playtiao.com/*` to the Worker
 * (wrangler.jsonc) and sends the paths below, through routes without a
 * Worker, to the Coolify origin. Locally, `wrangler dev` runs the same
 * Worker and Cloudflare's own asset worker on out/ (with `_redirects` and
 * `_headers`), and this front server sends the same paths to the API.
 *
 *   pnpm build && PORT=3001 API_PORT=5006 node serve-export.mjs
 *
 * Used by `pnpm start` and the Playwright suite.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { createServer as createNetServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApiProxy } from "./runtime-proxy.mjs";

// Keep in step with the deploy workflow (.github/workflows/build-and-deploy.yml).
export const WRANGLER_VERSION = "4.143.1";

/**
 * Path prefixes the zone sends to the origin instead of the Worker, one per
 * route without a Worker (`playtiao.com/api/*`, `playtiao.com/ws*`,
 * `playtiao.com/_e*`). Route patterns match by prefix like this.
 */
export const ORIGIN_PATH_PREFIXES = ["/api/", "/ws", "/_e"];

export const isOriginPath = (pathname) =>
  ORIGIN_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));

const here = dirname(fileURLToPath(import.meta.url));

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitFor(url, child, timeoutMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`wrangler dev exited with ${child.exitCode}`);
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`wrangler dev did not answer within ${timeoutMs} ms`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!existsSync(join(here, "out", "_redirects"))) {
    console.error("out/ is not a finished web export; run `pnpm build` first.");
    process.exit(1);
  }
  const port = Number.parseInt(process.env.PORT || "3000", 10);
  const apiTarget = process.env.API_URL || `http://127.0.0.1:${process.env.API_PORT || "5005"}`;
  const apiProxy = createApiProxy(apiTarget);
  const server = createServer((req, res) => {
    const { pathname } = new URL(req.url, "http://localhost");
    if (isOriginPath(pathname)) {
      apiProxy.http(req, res);
      return;
    }
    const upstream = httpRequest(
      {
        hostname: "127.0.0.1",
        port: assetsPort,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${assetsPort}` },
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Asset server unavailable");
    });
    req.pipe(upstream);
  });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url, "http://localhost");
    if (isOriginPath(pathname)) apiProxy.upgrade(req, socket, head);
    else socket.destroy();
  });

  // Listen first: a taken port fails here, before wrangler is started.
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, resolve);
  });

  const assetsPort = await freePort();

  const wrangler = spawn(
    "npx",
    [
      "--yes",
      `wrangler@${WRANGLER_VERSION}`,
      "dev",
      "--ip",
      "127.0.0.1",
      "--port",
      String(assetsPort),
      "--show-interactive-dev-session=false",
      // The Worker reads link-preview data from the API it fronts here.
      "--var",
      `API_ORIGIN:${new URL(apiTarget).origin}`,
    ],
    {
      cwd: here,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: process.env.CI ?? "true" },
      // Same process group as this server: a runner that kills the group
      // (Playwright does, with SIGKILL) stops wrangler and workerd too, and
      // nothing is left holding its output pipe open.
      stdio: ["ignore", "inherit", "inherit"],
    },
  );
  // A normal exit stops wrangler too (npm exec passes the signal on).
  process.on("exit", () => wrangler.kill("SIGTERM"));
  wrangler.once("exit", (code) => {
    console.error(`wrangler dev exited (${code})`);
    process.exit(1);
  });
  await waitFor(`http://127.0.0.1:${assetsPort}/version.json`, wrangler);
  console.log(`> Web export on http://localhost:${port} (API ${new URL(apiTarget).origin})`);

  const stop = async () => {
    server.closeAllConnections();
    await apiProxy.close();
    process.exit(0);
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
