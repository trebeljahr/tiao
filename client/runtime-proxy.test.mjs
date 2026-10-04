// @vitest-environment node
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { test } from "vitest";
import { createApiProxy } from "./runtime-proxy.mjs";

const require = createRequire(new URL("../server/package.json", import.meta.url));
const { WebSocket, WebSocketServer } = require("ws");
async function listen(server) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const port = 49152 + Math.floor(Math.random() * 16000);
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.removeListener("error", reject);
          resolve();
        });
      });
      return `http://127.0.0.1:${port}`;
    } catch (error) {
      if (error.code !== "EADDRINUSE") throw error;
    }
  }
  throw Error("No isolated test port available");
}
const stop = (server) =>
  new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  });

test("API health checks Mongo, Redis and realtime; writes are never retried by the proxy", async () => {
  let healthy = true;
  let writes = 0;
  const backend = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          rollingProtocol: 2,
          database: "connected",
          redis: "ok",
          realtime: "ready",
        }),
      );
    } else if (req.url === "/api/write") {
      req.resume();
      req.once("end", () => {
        writes++;
        res.destroy();
      });
    } else {
      res.end("ok");
    }
  });
  const endpoint = await listen(backend);
  const proxy = createApiProxy(endpoint);
  const frontend = createServer(proxy.http);
  const address = await listen(frontend);
  try {
    assert.equal(await proxy.ready(), true);
    healthy = false;
    assert.equal(await proxy.ready(), false);
    const response = await fetch(address + "/api/write", {
      method: "POST",
      body: "synthetic",
      signal: AbortSignal.timeout(2000),
    });
    assert.equal(response.status, 502);
    assert.equal(writes, 1);
    await proxy.close();
    assert.equal(await proxy.ready(), false);
  } finally {
    await proxy.close();
    await stop(frontend);
    await stop(backend);
  }
});

test("authenticated WebSockets cross the runtime proxy and close cleanly on retirement", async () => {
  const backend = createServer();
  const websockets = new WebSocketServer({ noServer: true });
  let observed;
  backend.on("upgrade", (req, socket, head) => {
    observed = { cookie: req.headers.cookie, origin: req.headers.origin, path: req.url };
    if (req.headers.cookie !== "session=synthetic") {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    websockets.handleUpgrade(req, socket, head, (ws) => {
      ws.on("message", (data) => ws.send(data));
    });
  });
  const endpoint = await listen(backend);
  const proxy = createApiProxy(endpoint);
  const frontend = createServer(proxy.http);
  frontend.on("upgrade", proxy.upgrade);
  const address = await listen(frontend);
  const socket = new WebSocket(address.replace("http:", "ws:") + "/api/ws/lobby?token=synthetic", {
    headers: { cookie: "session=synthetic", origin: address },
  });
  try {
    await once(socket, "open");
    assert.deepEqual(observed, {
      cookie: "session=synthetic",
      origin: address,
      path: "/api/ws/lobby?token=synthetic",
    });
    const echo = once(socket, "message");
    socket.send("synthetic snapshot");
    assert.equal((await echo)[0].toString(), "synthetic snapshot");
    const closed = once(socket, "close");
    await proxy.close();
    assert.equal((await closed)[0], 1001);
    await new Promise((resolve) => websockets.close(resolve));
  } finally {
    socket.terminate();
    for (const peer of websockets.clients) peer.terminate();
    await proxy.close();
    await stop(frontend);
    await stop(backend);
  }
});
