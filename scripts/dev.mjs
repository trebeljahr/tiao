#!/usr/bin/env node
// Starts both client and server for preview/worktree environments.
// Picks random free ports: client in 3000-4000, server in 5000-6000.
// Retries with a different random port if the chosen one is taken.

import { createServer } from "net";
import { execSync } from "child_process";

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

const clientPort = await findRandomFreePort(3000, 4000);
const apiPort = await findRandomFreePort(5000, 6000);

console.log(`\n  Client: http://127.0.0.1:${clientPort}`);
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
