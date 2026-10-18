import express, { type Request, type Response, Router } from "express";
import { createLogger } from "../lib/logger";

const log = createLogger("error-tunnel");

// ---------------------------------------------------------------------------
// POST /_e — GlitchTip (Sentry) envelope tunnel for the web client
// ---------------------------------------------------------------------------
//
// The browser SDK posts its envelopes to its own origin (Sentry's `tunnel`
// option) so ad blockers that filter Sentry and GlitchTip hosts let them
// through; this forwards them to GlitchTip. It lived in the web client's
// Node server until the client became a static site on Cloudflare.
//
// Path "/_e", not "/bugs": Cloudflare's managed WAF 403'd "/bugs" as a
// recon path, so every captured error failed in production (#160).
//
// Target: GLITCHTIP_PROXY_URL, else the host of this server's own
// GLITCHTIP_DSN (the same GlitchTip instance). Unset: the route is a 404.
// Only the envelope and its content type are forwarded, never cookies.
// The router parses its own raw body, so it must be mounted BEFORE the
// global express.json().

/**
 * Parse a Sentry envelope and build the GlitchTip ingestion path. In
 * `tunnel` mode the SDK puts the DSN in the envelope header's `dsn` field
 * and sends no `X-Sentry-Auth` header and no `?sentry_key=`; GlitchTip's
 * /api/<projectId>/envelope/ answers that with `403 {"detail": "Denied"}`,
 * so the classic auth query is rebuilt from the DSN. Throws on a malformed
 * envelope.
 */
export function buildGlitchtipEnvelopeTarget(body: Buffer): { targetPath: string } {
  const header = JSON.parse(body.toString("utf8").split("\n")[0]) as { dsn?: string };
  const dsnUrl = new URL(String(header.dsn));
  const projectId = dsnUrl.pathname.replace(/^\//, "");
  const publicKey = dsnUrl.username;
  if (!/^\d+$/.test(projectId) || !publicKey) {
    throw new Error("Envelope DSN is missing project ID or public key");
  }
  const query = `sentry_key=${encodeURIComponent(publicKey)}&sentry_version=7`;
  return { targetPath: `/api/${projectId}/envelope/?${query}` };
}

/** Where envelopes go, from the environment; null leaves the tunnel off. */
export function errorTunnelTargetFromEnv(env: NodeJS.ProcessEnv = process.env): URL | null {
  const configured = env.GLITCHTIP_PROXY_URL || env.GLITCHTIP_DSN;
  if (!configured) return null;
  try {
    return new URL(new URL(configured).origin);
  } catch {
    log.warn("GLITCHTIP_PROXY_URL / GLITCHTIP_DSN is not a URL; error tunnel off");
    return null;
  }
}

export function createErrorTunnelRouter(target: URL | null, fetchImpl: typeof fetch = fetch) {
  const router = Router();

  router.post(
    "/_e",
    express.raw({ type: () => true, limit: "1mb" }),
    async (req: Request, res: Response) => {
      if (!target) {
        res.status(404).json({ message: "Not found." });
        return;
      }
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      let targetPath: string;
      try {
        ({ targetPath } = buildGlitchtipEnvelopeTarget(body));
      } catch {
        res.status(400).json({ error: "Bad envelope" });
        return;
      }
      try {
        const upstream = await fetchImpl(new URL(targetPath, target), {
          method: "POST",
          body: new Uint8Array(body),
          headers: {
            "Content-Type": req.get("content-type") || "application/x-sentry-envelope",
          },
          signal: AbortSignal.timeout(10_000),
        });
        const contentType = upstream.headers.get("content-type");
        if (contentType) res.type(contentType);
        res.status(upstream.status).send(Buffer.from(await upstream.arrayBuffer()));
      } catch {
        log.warn("Monitoring upstream unavailable");
        res.status(502).json({ error: "Bad Gateway" });
      }
    },
  );

  return router;
}
