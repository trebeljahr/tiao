#!/usr/bin/env node
// Starts both client and server for development.
//
// Usage:
//   node scripts/dev.mjs           Random ports (3000-4000 client, 5000-6000 server)
//   node scripts/dev.mjs --fixed   Fixed ports (3000 client, 5005 server)
//   npm run dev                    Random ports
//   npm run dev:fixed              Fixed ports (3000/5005)

import { createServer } from "net";
import { execSync } from "child_process";

const fixedMode = process.argv.includes("--fixed");

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
  throw new Error(`Could not find a free port in range ${min}-${max} after ${maxAttempts} attempts`);
}

let clientPort;
let apiPort;

if (process.env.PORT) {
  clientPort = parseInt(process.env.PORT, 10);
} else if (fixedMode) {
  clientPort = 3000;
} else {
  clientPort = await findRandomFreePort(3000, 4000);
}

if (process.env.API_PORT) {
  apiPort = parseInt(process.env.API_PORT, 10);
} else if (fixedMode) {
  apiPort = 5005;
} else {
  apiPort = await findRandomFreePort(5000, 6000);
}

console.log(`\n  Mode:   ${fixedMode ? "fixed" : "random"}`);
console.log(`  Client: http://127.0.0.1:${clientPort}`);
console.log(`  Server: http://127.0.0.1:${apiPort}\n`);

try {
  execSync(
    `npx concurrently -k -n client,server -c yellow,cyan` +
    ` "PORT=${clientPort} API_PORT=${apiPort} npm --prefix client run dev"` +
    ` "PORT=${apiPort} npm --prefix server run dev"`,
    { stdio: "inherit" },
  );
} catch {
  process.exit(1);
}
