import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

/** Runtime API transport. Writes are forwarded once; the browser owns recovery. */
export function createApiProxy(target, { healthTimeoutMs = 1500 } = {}) {
  const upstream = new URL(target);
  if (!["http:", "https:"].includes(upstream.protocol)) throw Error("Invalid API protocol");
  const request = upstream.protocol === "https:" ? httpsRequest : httpRequest;
  const pending = new Map();
  const tunnels = new Set();
  let closing = false;
  let healthCheck;
  const options = (req) => ({
    hostname: upstream.hostname,
    port: upstream.port || (upstream.protocol === "https:" ? 443 : 80),
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: upstream.host },
  });
  const failed = (res) => {
    if (res.headersSent) return res.destroy();
    res.writeHead(502, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end('{"error":"API temporarily unavailable"}');
  };

  function http(req, res) {
    if (closing) {
      failed(res);
      return;
    }
    const proxy = request(options(req), (response) => {
      const location = response.headers.location;
      if (location) {
        try {
          const redirect = new URL(location, upstream);
          if (redirect.origin === upstream.origin)
            response.headers.location = redirect.pathname + redirect.search + redirect.hash;
        } catch {
          /* Preserve an invalid upstream value for the browser to reject. */
        }
      }
      res.writeHead(response.statusCode ?? 502, response.headers);
      response.on("error", () => res.destroy());
      response.pipe(res);
    });
    proxy.setTimeout(30_000, () => proxy.destroy());
    proxy.on("error", () => failed(res));
    req.on("aborted", () => proxy.destroy());
    res.on("close", () => {
      if (!res.writableFinished) proxy.destroy();
    });
    req.pipe(proxy);
  }

  function upgrade(req, socket, head) {
    if (closing) {
      socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
      return;
    }
    const proxy = request(options(req));
    pending.set(proxy, socket);
    socket.on("error", () => proxy.destroy());
    socket.once("close", () => {
      pending.delete(proxy);
      proxy.destroy();
    });
    proxy.setTimeout(10_000, () => proxy.destroy());
    proxy.on("error", () => {
      pending.delete(proxy);
      socket.destroy();
    });
    proxy.on("response", (response) => {
      pending.delete(proxy);
      socket.write(
        `HTTP/1.1 ${response.statusCode ?? 502} ${response.statusMessage ?? ""}\r\nConnection: close\r\n\r\n`,
      );
      response.on("error", () => socket.destroy());
      response.pipe(socket);
    });
    proxy.on("upgrade", (response, remote, remoteHead) => {
      pending.delete(proxy);
      if (closing || socket.destroyed) {
        remote.destroy();
        socket.destroy();
        return;
      }
      proxy.setTimeout(0);
      remote.setTimeout(0);
      socket.setTimeout(0);
      const pair = { socket, remote };
      tunnels.add(pair);
      const lines = ["HTTP/1.1 101 Switching Protocols"];
      for (const [key, values] of Object.entries(response.headers))
        for (const value of Array.isArray(values) ? values : [values])
          if (value !== undefined) lines.push(`${key}: ${value}`);
      socket.write(lines.join("\r\n") + "\r\n\r\n");
      if (remoteHead.length) socket.write(remoteHead);
      if (head.length) remote.write(head);
      remote.on("error", () => socket.destroy());
      socket.on("error", () => remote.destroy());
      remote.once("close", () => {
        tunnels.delete(pair);
        socket.destroy();
      });
      socket.once("close", () => {
        tunnels.delete(pair);
        remote.destroy();
      });
      remote.pipe(socket);
      socket.pipe(remote);
    });
    proxy.end();
  }

  function ready() {
    if (closing) return Promise.resolve(false);
    // Coalesce simultaneous probes, but never cache health across a drain/gap.
    healthCheck ??= fetch(new URL("/health", upstream), {
      signal: AbortSignal.timeout(healthTimeoutMs),
    })
      .then(async (response) => {
        if (!response.ok || closing) return false;
        const status = await response.json();
        return (
          status.rollingProtocol === 2 &&
          status.database === "connected" &&
          status.redis === "ok" &&
          status.realtime === "ready"
        );
      })
      .catch(() => false)
      .finally(() => {
        healthCheck = undefined;
      });
    return healthCheck;
  }

  async function close() {
    closing = true;
    for (const [proxy, socket] of pending) {
      proxy.destroy();
      socket.destroy();
    }
    pending.clear();
    await Promise.all(
      [...tunnels].map(
        ({ socket, remote }) =>
          new Promise((resolve) => {
            if (socket.destroyed) {
              remote.destroy();
              resolve();
              return;
            }
            const force = setTimeout(() => {
              socket.destroy();
              remote.destroy();
              resolve();
            }, 2000);
            force.unref();
            socket.once("close", () => {
              clearTimeout(force);
              remote.destroy();
              resolve();
            });
            // Stop upstream bytes first, then send a server close frame: 1001
            // (going away). If upstream stopped mid-frame the browser sees an
            // abnormal close instead; both trigger its normal reconnect.
            // Upstream is destroyed once the browser acknowledges (socket close).
            remote.unpipe(socket);
            socket.end(Buffer.from([0x88, 0x02, 0x03, 0xe9]));
          }),
      ),
    );
  }
  return { http, upgrade, ready, close };
}
