#!/usr/bin/env node
// Starts client, server, and (optionally) docs for development.
//
// Usage:
//   node scripts/dev.mjs                 Random ports (client 3100-3999, docs 4100-4999, server 5100-5999)
//   node scripts/dev.mjs --fixed         Fixed ports (client 3000, docs 4000, server 5000)
//   node scripts/dev.mjs --docs          Include docs site
//   node scripts/dev.mjs --fixed --docs  Fixed ports with docs
//   node scripts/dev.mjs --fixed --lan   Fixed ports, accessible from LAN
//   npm run dev                          Random ports (client + server)
//   npm run dev:parallel                 2 instances in parallel (random ports,
//                                        per-port .next-<port>/ dist dirs,
//                                        cleaned up on exit). For Redis queue /
//                                        horizontal scaling testing.
//   npm run dev:parallel -- 3            Same, but with 3 instances (1-10).
//   npm run dev:fixed                    Fixed ports (client + server)
//   npm run dev:lan                      Fixed ports, accessible from LAN (for mobile testing)
//   npm run dev:docs                     Random ports (client + server + docs)
//   npm run dev:docs:fixed               Fixed ports (client + server + docs)

import { createServer } from "net";
import { execSync, spawn } from "child_process";
import { rm } from "fs/promises";
import { resolve } from "path";

const args = process.argv.slice(2);
const fixedMode = args.includes("--fixed");
const includeDocs = args.includes("--docs");
const lanMode = args.includes("--lan");
const parallelMode = process.env.DEV_PARALLEL === "1";

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

// Cleanup per-port .next dirs on exit (parallel mode only). Next writes dev
// artifacts into .next-<port>/dev/, so removing .next-<port>/ takes everything
// including the lockfile. force:true makes it a no-op if the dir never existed.
async function cleanup() {
  if (!parallelMode) return;
  console.log("\n  Cleaning up per-port dist dirs...");
  for (const port of clientPorts) {
    const dir = resolve("client", `.next-${port}`);
    try {
      await rm(dir, { recursive: true, force: true });
      console.log(`    ✓ ${dir}`);
    } catch (err) {
      console.error(`    ✗ ${dir} — ${err.message}`);
    }
  }
}

// Forward SIGINT/SIGTERM so a single Ctrl+C stops everything
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => child.kill(sig));
}

// Run cleanup exactly once, on whichever terminal event fires first.
let cleaningUp = false;
async function exitWith(code) {
  if (cleaningUp) return;
  cleaningUp = true;
  await cleanup();
  process.exit(code ?? 1);
}

child.on("exit", (code) => exitWith(code));
child.on("error", (err) => {
  console.error(`Failed to spawn concurrently: ${err.message}`);
  exitWith(1);
});
