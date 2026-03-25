#!/usr/bin/env node
// Starts both client and server for preview/worktree environments.
// Finds truly free ports by probing 127.0.0.1 (matching Vite and Express).
// Accepts PORT from the preview system as a starting preference but will
// search upward if it's already taken.

import { createServer } from "net";
import { execSync } from "child_process";

function findFreePort(preferred) {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(preferred, "127.0.0.1", () => {
      server.close(() => resolve(preferred));
    });
    server.on("error", () => resolve(findFreePort(preferred + 1)));
  });
}

const clientPort = await findFreePort(parseInt(process.env.PORT || "3000", 10));
const apiPort = await findFreePort(clientPort + 1);

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
