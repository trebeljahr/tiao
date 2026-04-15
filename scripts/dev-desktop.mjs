#!/usr/bin/env node
// Dev orchestrator for the Electron desktop app.
//
// Spawns the Express backend on a random free port in 5100-5999 and
// the desktop Electron shell with a freshly built client-bundle that
// bakes in that same port. Ctrl+C (or closing the Electron window)
// tears everything down via concurrently's -k flag.
//
// Usage:
//   node scripts/dev-desktop.mjs
//
// Why a random port instead of the hardcoded 5005 from --fixed mode:
// you can run this alongside `npm run dev` (client+server pair) on
// the same machine without port conflicts. Redis (ADR #2) handles
// the shared state — both backend instances will see the same game
// rooms, matchmaking queue, locks, and lobby subscriptions, so a
// guest signed in via the regular web dev server can be paired
// against a desktop user via matchmaking.
//
// Prereqs (same as `npm run dev` from root):
//   - server/.env populated with TOKEN_SECRET, MONGODB_URI, S3 creds
//   - Redis + Mongo reachable (docker-compose.dev.yml handles this)

import { createServer } from "net";
import { spawn } from "child_process";

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findRandomFreePort(min, max, maxAttempts = 20) {
  for (let i = 0; i < maxAttempts; i++) {
    const port = randomInt(min, max);
    if (await isPortFree(port)) {
      return port;
    }
  }
  throw new Error(
    `Could not find a free port in range ${min}-${max} after ${maxAttempts} attempts`,
  );
}

// Pick a server port. Honors process.env.PORT if set (lets a
// maintainer pin a port from the command line for ad-hoc debugging).
let apiPort;
if (process.env.PORT) {
  apiPort = parseInt(process.env.PORT, 10);
} else {
  apiPort = await findRandomFreePort(5100, 5999);
}

const apiUrl = `http://localhost:${apiPort}`;

console.log("");
console.log(`  Desktop dev orchestrator`);
console.log(`  Server: ${apiUrl}`);
console.log(`  Desktop: Electron (client-bundle baked against ${apiUrl})`);
console.log(``);
console.log(`  Redis-shared state: games and matchmaking are visible to`);
console.log(`  any other 'npm run dev' instance on this machine.`);
console.log("");

// concurrently handles signal forwarding (SIGINT from Ctrl+C tears
// down both children) and -k (--kill-others) means when Electron
// exits or the server crashes, the sibling is terminated too.
const concurrentlyBin = new URL("../node_modules/.bin/concurrently", import.meta.url).pathname;

// The server command: fixed PORT env var so server picks up our
// allocated port. `npm --prefix server run dev` wraps nodemon which
// respects PORT via server/config/envVars.ts.
const serverCmd = `PORT=${apiPort} npm --prefix server run dev`;

// The desktop command: wait for the server to accept connections
// (scripts/wait-for-port.mjs polls 127.0.0.1:<port>), then invoke
// dev:fresh with BOTH env vars set:
//
//   - NEXT_PUBLIC_DESKTOP_API_URL bakes our random port into the
//     static export as a build-time fallback (read by
//     client/src/lib/api.ts when window.electron.config isn't
//     available — dead code in normal desktop operation but kept
//     as a safety net).
//
//   - TIAO_API_URL is the one that ACTUALLY takes effect at runtime.
//     desktop/main.cjs → resolveApiUrl() reads it and passes it to
//     the renderer via window.electron.config.apiUrl, which
//     client/src/lib/api.ts:getApiBaseUrl() prefers over every
//     other source. Without this, resolveApiUrl() falls back to
//     its hardcoded http://localhost:5005 default and the renderer
//     talks to a port nothing is listening on.
const desktopCmd = [
  `node scripts/wait-for-port.mjs ${apiPort}`,
  `NEXT_PUBLIC_DESKTOP_API_URL=${apiUrl} TIAO_API_URL=${apiUrl} npm --prefix desktop run dev:fresh`,
].join(" && ");

const child = spawn(
  concurrentlyBin,
  ["-k", "-n", "server,desktop", "-c", "cyan,magenta", `"${serverCmd}"`, `"${desktopCmd}"`],
  { stdio: "inherit" },
);

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => child.kill(sig));
}

child.on("exit", (code) => process.exit(code ?? 1));
