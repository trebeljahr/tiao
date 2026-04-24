#!/usr/bin/env node
// Waits for a TCP port to accept connections, then exits 0.
// Usage: node scripts/wait-for-port.mjs <port> [timeout_seconds]

import { connect } from "node:net";

const port = Number.parseInt(process.argv[2], 10);
const timeout = (Number.parseInt(process.argv[3], 10) || 30) * 1000;

if (!port) {
  console.error("Usage: wait-for-port.mjs <port> [timeout_seconds]");
  process.exit(1);
}

const start = Date.now();

function check() {
  const sock = connect(port, "127.0.0.1", () => {
    sock.destroy();
    process.exit(0);
  });
  sock.on("error", () => {
    if (Date.now() - start > timeout) {
      console.error(`[wait] port ${port} did not open within ${timeout / 1000}s`);
      process.exit(1);
    }
    setTimeout(check, 500);
  });
}

check();
