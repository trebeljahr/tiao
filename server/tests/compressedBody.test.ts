import assert from "node:assert/strict";
import { once } from "node:events";
import { request, type ClientRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { deflateSync, gzipSync } from "node:zlib";
import express from "express";
import { configureApp } from "../config";

test("request parsing survives bytes arriving after a complete compressed frame", {
  timeout: 10_000,
}, async () => {
  const app = express();
  configureApp(app);
  let client: ClientRequest | undefined;
  app.post("/echo", (req, res) => {
    // Wait for the HTTP body after the decoder has already completed. This
    // exercises GHSA-27r3-jxmh-p828 without any real application records.
    req.once("end", () => res.json(req.body));
    client!.end(Buffer.alloc(64));
  });
  app.get("/alive", (_req, res) => res.sendStatus(204));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  try {
    const frame = Buffer.concat([deflateSync(Buffer.from('{"safe":true}')), Buffer.of(0)]);
    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      client = request(
        {
          host: "127.0.0.1",
          port,
          method: "POST",
          path: "/echo",
          agent: false,
          headers: {
            "content-type": "application/json",
            "content-encoding": "deflate",
            "content-length": frame.length + 64,
          },
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (part) => {
            body += part;
          });
          res.on("error", reject);
          res.on("end", () => resolve({ status: res.statusCode!, body }));
        },
      );
      client.on("error", reject);
      client.setTimeout(3000, () =>
        client!.destroy(new Error("Compressed request did not finish")),
      );
      client.write(frame);
    });
    assert.equal(result.status, 200);
    assert.deepEqual(JSON.parse(result.body), { safe: true });
    assert.equal((await fetch(`http://127.0.0.1:${port}/alive`)).status, 204);
  } finally {
    client?.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("normal compressed JSON still parses and malformed input leaves the server usable", {
  timeout: 10_000,
}, async () => {
  const app = express();
  configureApp(app);
  app.post("/echo", (req, res) => res.json(req.body));
  app.use(
    (
      error: { status?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.sendStatus(error.status ?? 500);
    },
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/echo`;
  try {
    const valid = gzipSync('{"safe":true}');
    const cases = [
      { body: valid, status: 200 },
      { body: Buffer.from("invalid gzip"), status: 400 },
      { body: Buffer.concat([valid, Buffer.of(0), Buffer.alloc(96 * 1024, 0x5a)]), status: 200 },
      { body: valid, status: 200 },
    ];
    for (const { body, status } of cases) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "content-encoding": "gzip" },
        body: new Uint8Array(body),
      });
      assert.equal(response.status, status);
      if (status === 200) {
        assert.deepEqual(await response.json(), { safe: true });
      }
      // Leave time for errors queued after the decoder's readable end.
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
