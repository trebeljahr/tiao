#!/usr/bin/env node
// Starts client, server, and (optionally) docs for development.
//
// Infra (Redis + Mongo + MinIO) is auto-started on every invocation unless
// you pass `--skip-infra`. The script first TCP-pings Redis (6379) and Mongo
// (27017) — if both are already reachable (either docker-compose is already
// up, or you run Redis/Mongo natively via brew/apt), we skip the docker
// compose call entirely for a fast startup. If either port is unreachable,
// we bring up docker-compose.dev.yml and poll both ports until they become
// ready. If Docker isn't installed, the script falls through with a warning.
//
// Usage:
//   node scripts/dev.mjs                 Random ports (client 3100-3999, docs 4100-4999, server 5100-5999)
//   node scripts/dev.mjs --fixed         Fixed ports (client 3000, docs 4000, server 5000)
//   node scripts/dev.mjs --docs          Include docs site
//   node scripts/dev.mjs --fixed --docs  Fixed ports with docs
//   node scripts/dev.mjs --fixed --lan   Fixed ports, accessible from LAN
//   node scripts/dev.mjs --skip-infra    Don't auto-start docker infra
//   npm run dev                          Random ports (client + server)
//   npm run dev:parallel                 2 instances in parallel (random ports,
//                                        shared .next dir so Turbopack's
//                                        font cache is shared). For Redis
//                                        queue / horizontal scaling testing —
//                                        run with two browser profiles, each
//                                        pointed at a different client port,
//                                        to verify matchmaking works across
//                                        instances.
//   npm run dev:parallel -- 3            Same, but with 3 instances (1-10).
//   npm run dev:fixed                    Fixed ports (client + server)
//   npm run dev:lan                      Fixed ports, accessible from LAN (for mobile testing)
//   npm run dev:docs                     Random ports (client + server + docs)
//   npm run dev:docs:fixed               Fixed ports (client + server + docs)

import { createServer, Socket } from "net";
import { execSync, spawn } from "child_process";

const args = process.argv.slice(2);
const fixedMode = args.includes("--fixed");
const includeDocs = args.includes("--docs");
const lanMode = args.includes("--lan");
const skipInfra = args.includes("--skip-infra");
const parallelMode = process.env.DEV_PARALLEL === "1";

// ─── Auto-start dev infrastructure ────────────────────────────────────
//
// TCP-ping Redis (6379) and Mongo (27017) first. If both are already
// reachable we skip docker compose entirely — that's the common case
// when you ran `npm run dev` earlier in the session, or when you run
// Redis/Mongo natively via brew/apt.
//
// If either port is unreachable we bring up docker-compose.dev.yml and
// poll both ports until they come online (up to 30s) so the client +
// server processes we spawn next don't race Redis's startup.
//
// We tolerate Docker being missing/unavailable: if the command fails,
// we warn and continue. The server will still fail loudly later if
// REDIS_URL isn't reachable — see createGameService() in
// server/game/gameService.ts.

/**
 * TCP-ping a host:port with a short timeout. Returns true if the
 * connection succeeds before the deadline, false otherwise (refused,
 * unreachable, timeout, DNS error, etc.).
 */
function isPortOpen(host, port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
    socket.connect(port, host);
  });
}

/** Poll both infra ports until they're reachable or deadline passes. */
async function waitForInfraReady(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [redis, mongo] = await Promise.all([
      isPortOpen("127.0.0.1", 6379),
      isPortOpen("127.0.0.1", 27017),
    ]);
    if (redis && mongo) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function startDevInfra() {
  if (skipInfra) {
    console.log("  Infra:  skipped (--skip-infra)");
    return;
  }

  // Fast path: if both ports are already reachable, don't touch docker.
  // This is the common case after the first dev run in a session.
  const [redisUp, mongoUp] = await Promise.all([
    isPortOpen("127.0.0.1", 6379),
    isPortOpen("127.0.0.1", 27017),
  ]);

  if (redisUp && mongoUp) {
    console.log("  Infra:  up (Redis + Mongo reachable)");
    return;
  }

  const missing = [];
  if (!redisUp) missing.push("Redis:6379");
  if (!mongoUp) missing.push("Mongo:27017");
  console.log(`  Infra:  starting docker compose (${missing.join(", ")} unreachable)...`);

  try {
    execSync("docker compose -f docker-compose.dev.yml up -d", {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    console.warn("  Infra:  ⚠  docker compose up failed — is Docker running? Continuing anyway.");
    console.warn(`          ${err.message.split("\n")[0]}`);
    console.warn("          If you run Redis/Mongo natively, pass --skip-infra to silence this.");
    return;
  }

  // docker compose up -d returns as soon as the containers are CREATED,
  // which is before the Redis server inside actually accepts connections.
  // Poll the ports so the client + server we spawn next don't race the
  // container startup.
  const ready = await waitForInfraReady();
  if (ready) {
    console.log("  Infra:  up (Redis + Mongo ready)");
  } else {
    console.warn("  Infra:  ⚠  docker compose succeeded but ports are not reachable after 30s");
    console.warn("          The server may fail on startup — check `docker compose ps`");
  }
}

await startDevInfra();

// Parallel mode: determine instance count from first positional integer arg,
// then from DEV_PARALLEL_COUNT env var, then default to 2.
let instanceCount = 1;
if (parallelMode) {
  const countArg = args.find((a) => /^\d+$/.test(a));
  if (countArg) {
    instanceCount = parseInt(countArg, 10);
  } else if (process.env.DEV_PARALLEL_COUNT) {
    instanceCount = parseInt(process.env.DEV_PARALLEL_COUNT, 10);
  } else {
    instanceCount = 2;
  }
  if (!Number.isFinite(instanceCount) || instanceCount < 1 || instanceCount > 10) {
    console.error(`Invalid parallel count: ${instanceCount} (must be 1-10)`);
    process.exit(1);
  }
  if (fixedMode) {
    console.error(
      "dev:parallel is incompatible with --fixed (N instances can't share one fixed port)",
    );
    process.exit(1);
  }
  if (includeDocs) {
    console.error("dev:parallel is incompatible with --docs");
    process.exit(1);
  }
  if (lanMode) {
    console.error("dev:parallel does not support --lan (localhost only)");
    process.exit(1);
  }
}

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

const usedPorts = new Set();

async function findUniqueFreePort(min, max, maxAttempts = 50) {
  for (let i = 0; i < maxAttempts; i++) {
    const port = randomInt(min, max);
    if (usedPorts.has(port)) continue;
    if (await isPortFree(port)) {
      usedPorts.add(port);
      return port;
    }
  }
  throw new Error(
    `Could not find a free port in range ${min}-${max} after ${maxAttempts} attempts`,
  );
}

// Allocate ports. In parallel mode: N unique random pairs. Otherwise: 1 pair,
// honoring env overrides and --fixed.
const clientPorts = [];
const apiPorts = [];
let docsPort;

if (parallelMode) {
  for (let i = 0; i < instanceCount; i++) {
    clientPorts.push(await findUniqueFreePort(3100, 3999));
    apiPorts.push(await findUniqueFreePort(5100, 5999));
  }
} else {
  let clientPort;
  if (process.env.PORT) {
    clientPort = parseInt(process.env.PORT, 10);
  } else if (fixedMode) {
    clientPort = 3000;
  } else {
    clientPort = await findUniqueFreePort(3100, 3999);
  }
  clientPorts.push(clientPort);

  let apiPort;
  if (process.env.API_PORT) {
    apiPort = parseInt(process.env.API_PORT, 10);
  } else if (fixedMode) {
    apiPort = 5005;
  } else {
    apiPort = await findUniqueFreePort(5100, 5999);
  }
  apiPorts.push(apiPort);

  if (includeDocs) {
    if (process.env.DOCS_PORT) {
      docsPort = parseInt(process.env.DOCS_PORT, 10);
    } else if (fixedMode) {
      docsPort = 4004;
    } else {
      docsPort = await findUniqueFreePort(4100, 4999);
    }
  }
}

let lanIp = "";
if (lanMode) {
  try {
    lanIp = execSync("ipconfig getifaddr en0", { encoding: "utf8" }).trim();
  } catch {
    // fallback below
  }
}

// Print startup banner
const mode = parallelMode ? `parallel × ${instanceCount}` : fixedMode ? "fixed" : "random";
console.log(`\n  Mode:   ${mode}${lanMode ? " (LAN)" : ""}`);

if (parallelMode) {
  const pad = String(instanceCount).length;
  for (let i = 0; i < instanceCount; i++) {
    const n = String(i + 1).padStart(pad, " ");
    console.log(`  [${n}] client → http://localhost:${clientPorts[i]}`);
    console.log(`  [${n}] server → http://localhost:${apiPorts[i]}`);
  }
} else {
  console.log(`  Client: http://localhost:${clientPorts[0]}`);
  if (includeDocs) {
    console.log(`  Docs:   http://localhost:${docsPort}`);
  }
  console.log(`  Server: http://localhost:${apiPorts[0]}`);
  if (lanMode) {
    if (lanIp) {
      console.log(`\n  LAN:    http://${lanIp}:${clientPorts[0]}`);
    } else {
      console.log(`\n  LAN:    (could not detect LAN IP — check ipconfig getifaddr en0)`);
    }
  }
}
console.log();

// Build process list for concurrently. In parallel mode each instance gets its
// own numbered name and a distinct color pair.
const CLIENT_COLORS = ["yellow", "magenta", "blue", "red", "cyan.bold"];
const SERVER_COLORS = ["cyan", "green", "red", "yellow.bold", "magenta.bold"];

const processes = [];
const names = [];
const colors = [];

for (let i = 0; i < clientPorts.length; i++) {
  const cPort = clientPorts[i];
  const sPort = apiPorts[i];
  const suffix = parallelMode ? `-${i + 1}` : "";

  processes.push(
    `"node scripts/wait-for-port.mjs ${sPort} && PORT=${cPort} API_PORT=${sPort} NEXT_PUBLIC_API_PORT=${sPort} npm --prefix client run dev"`,
  );
  processes.push(`"PORT=${sPort} npm --prefix server run dev"`);

  names.push(`client${suffix}`);
  names.push(`server${suffix}`);
  colors.push(parallelMode ? CLIENT_COLORS[i % CLIENT_COLORS.length] : "yellow");
  colors.push(parallelMode ? SERVER_COLORS[i % SERVER_COLORS.length] : "cyan");
}

if (includeDocs) {
  processes.push(`"npm --prefix docs-site start -- --port ${docsPort}"`);
  names.push("docs");
  colors.push("magenta");
}

const concurrentlyBin = new URL("../node_modules/.bin/concurrently", import.meta.url).pathname;

const child = spawn(
  concurrentlyBin,
  ["-k", "-n", names.join(","), "-c", colors.join(","), ...processes],
  { stdio: "inherit" },
);

// Forward SIGINT/SIGTERM so a single Ctrl+C stops everything
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => child.kill(sig));
}

child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (err) => {
  console.error(`Failed to spawn concurrently: ${err.message}`);
  process.exit(1);
});
