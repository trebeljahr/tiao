import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, test } from "node:test";
import express from "express";
import {
  buildGlitchtipEnvelopeTarget,
  createErrorTunnelRouter,
  errorTunnelTargetFromEnv,
} from "../routes/errorTunnel.routes";

function envelope(dsn: string) {
  const header = JSON.stringify({ sent_at: "2026-10-15T00:00:00.000Z", dsn });
  return Buffer.from(`${header}\n{"type":"session"}\n{"sid":"s","status":"ok"}`);
}

describe("buildGlitchtipEnvelopeTarget", () => {
  test("rebuilds the classic auth query from the envelope's DSN", () => {
    const { targetPath } = buildGlitchtipEnvelopeTarget(
      envelope("https://abc123def@glitchtip.example.com/42"),
    );
    assert.equal(targetPath, "/api/42/envelope/?sentry_key=abc123def&sentry_version=7");
  });

  test("reads only the first line as the header", () => {
    const body = Buffer.concat([
      envelope("https://k@glitchtip.example.com/7"),
      Buffer.from('\n{"dsn":"https://evil@x.example/9"}'),
    ]);
    assert.match(buildGlitchtipEnvelopeTarget(body).targetPath, /^\/api\/7\//);
  });

  test("rejects a header without a usable DSN", () => {
    assert.throws(() => buildGlitchtipEnvelopeTarget(Buffer.from("not json")));
    assert.throws(() => buildGlitchtipEnvelopeTarget(envelope("https://glitchtip.example.com/1")));
    assert.throws(() => buildGlitchtipEnvelopeTarget(envelope("https://k@glitchtip.example.com/")));
  });
});

describe("errorTunnelTargetFromEnv", () => {
  test("prefers GLITCHTIP_PROXY_URL, else the server DSN's host", () => {
    assert.equal(
      errorTunnelTargetFromEnv({
        GLITCHTIP_PROXY_URL: "https://proxy.example.com/x",
        GLITCHTIP_DSN: "https://k@dsn.example.com/2",
      })?.origin,
      "https://proxy.example.com",
    );
    assert.equal(
      errorTunnelTargetFromEnv({ GLITCHTIP_DSN: "https://k@dsn.example.com/2" })?.href,
      "https://dsn.example.com/",
    );
    assert.equal(errorTunnelTargetFromEnv({}), null);
  });
});

async function withTunnel(
  target: URL | null,
  upstream: typeof fetch,
  run: (base: string) => Promise<void>,
) {
  const app = express();
  const router = createErrorTunnelRouter(target, upstream);
  app.use("/", router);
  app.use("/api", router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("POST /_e and /api/_e", () => {
  test("forwards the envelope bytes, and nothing else, to GlitchTip", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const upstream = (async (url: URL, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response('{"id":"e1"}', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const body = envelope("https://pub@glitchtip.example.com/1");
    await withTunnel(new URL("https://glitchtip.example.com"), upstream, async (base) => {
      for (const path of ["/_e", "/api/_e"]) {
        const res = await fetch(`${base}${path}`, {
          method: "POST",
          body,
          headers: { "Content-Type": "text/plain;charset=UTF-8", Cookie: "session=secret" },
        });
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { id: "e1" });
      }
    });
    assert.equal(calls.length, 2);
    assert.equal(
      calls[0].url,
      "https://glitchtip.example.com/api/1/envelope/?sentry_key=pub&sentry_version=7",
    );
    assert.deepEqual(Buffer.from(calls[0].init.body as Uint8Array), body);
    assert.deepEqual(calls[0].init.headers, { "Content-Type": "text/plain;charset=UTF-8" });
  });

  test("answers 400 for a malformed envelope and 502 when GlitchTip is down", async () => {
    const down = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await withTunnel(new URL("https://glitchtip.example.com"), down, async (base) => {
      const bad = await fetch(`${base}/api/_e`, { method: "POST", body: "nope" });
      assert.equal(bad.status, 400);
      const unreachable = await fetch(`${base}/api/_e`, {
        method: "POST",
        body: envelope("https://pub@glitchtip.example.com/1"),
      });
      assert.equal(unreachable.status, 502);
    });
  });

  test("is a 404 when no GlitchTip is configured", async () => {
    await withTunnel(null, fetch, async (base) => {
      const res = await fetch(`${base}/api/_e`, { method: "POST", body: "x" });
      assert.equal(res.status, 404);
    });
  });
});
