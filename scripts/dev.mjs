#!/usr/bin/env node
// Starts client, server, and (optionally) docs for development.
//
// Usage:
//   node scripts/dev.mjs                Random ports (client 3100-3999, docs 4100-4999, server 5100-5999)
//   node scripts/dev.mjs --fixed        Fixed ports (client 3000, docs 4000, server 5000)
//   node scripts/dev.mjs --docs         Include docs site
//   node scripts/dev.mjs --fixed --docs Fixed ports with docs
//   node scripts/dev.mjs --fixed --lan  Fixed ports, accessible from LAN
//   npm run dev                         Random ports (client + server)
//   npm run dev:fixed                   Fixed ports (client + server)
//   npm run dev:lan                     Fixed ports, accessible from LAN (for mobile testing)
//   npm run dev:docs                    Random ports (client + server + docs)
//   npm run dev:docs:fixed              Fixed ports (client + server + docs)

import { createServer } from "net";
import { execSync } from "child_process";

const fixedMode = process.argv.includes("--fixed");
const includeDocs = process.argv.includes("--docs");
const lanMode = process.argv.includes("--lan");

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

let clientPort;
let docsPort;
let apiPort;

if (process.env.PORT) {
  clientPort = parseInt(process.env.PORT, 10);
} else if (fixedMode) {
  clientPort = 3000;
} else {
  clientPort = await findRandomFreePort(3100, 3999);
}

if (process.env.DOCS_PORT) {
  docsPort = parseInt(process.env.DOCS_PORT, 10);
} else if (fixedMode) {
  docsPort = 4004;
} else {
  docsPort = await findRandomFreePort(4100, 4999);
}

if (process.env.API_PORT) {
  apiPort = parseInt(process.env.API_PORT, 10);
} else if (fixedMode) {
  apiPort = 5005;
} else {
  apiPort = await findRandomFreePort(5100, 5999);
}

const host = lanMode ? "0.0.0.0" : "127.0.0.1";

console.log(`\n  Mode:   ${fixedMode ? "fixed" : "random"}${lanMode ? " (LAN)" : ""}`);
console.log(`  Client: http://${host}:${clientPort}`);
if (includeDocs) {
  console.log(`  Docs:   http://${host}:${docsPort}`);
}
console.log(`  Server: http://${host}:${apiPort}`);
if (lanMode) {
  try {
    const lanIp = execSync("ipconfig getifaddr en0", { encoding: "utf8" }).trim();
    console.log(`\n  LAN:    http://${lanIp}:${clientPort}`);
  } catch {
    console.log(`\n  LAN:    (could not detect LAN IP — check ipconfig getifaddr en0)`);
  }
}
console.log();

const processes = [
  `"node scripts/wait-for-port.mjs ${apiPort} && PORT=${clientPort} API_PORT=${apiPort} NEXT_PUBLIC_WS_URL=ws://127.0.0.1:${apiPort} VITE_HOST=${host} npm --prefix client run dev"`,
  `"PORT=${apiPort} npm --prefix server run dev"`,
];
const names = ["client", "server"];
const colors = ["yellow", "cyan"];

if (includeDocs) {
  processes.push(`"npm --prefix docs-site start -- --port ${docsPort}"`);
  names.push("docs");
  colors.push("magenta");
}

try {
  execSync(
    `npx concurrently -k -n ${names.join(",")} -c ${colors.join(",")}` +
      ` ${processes.join(" ")}`,
    { stdio: "inherit" },
  );
} catch {
  process.exit(1);
}
