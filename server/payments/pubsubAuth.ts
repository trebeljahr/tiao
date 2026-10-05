import { createPublicKey, type JsonWebKey, timingSafeEqual, verify } from "node:crypto";

/**
 * Authenticates Pub/Sub push deliveries (Google Play Real-time Developer
 * Notifications).
 *
 * Preferred: the push subscription has authentication enabled, so every
 * request carries `Authorization: Bearer <Google-signed OIDC JWT>`. We check
 * the RS256 signature against Google's published keys plus issuer, audience,
 * expiry and (when configured) the signing service account's email.
 *
 * Fallback: a shared secret in the push endpoint's `?token=` query string,
 * for setups where OIDC push auth is not enabled yet.
 */

const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
const CLOCK_SKEW_SECONDS = 300;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
type Jwk = JsonWebKey & { kid?: string };

export type PushAuthConfig = {
  /** Audience set on the push subscription. Enables OIDC verification. */
  audience?: string;
  /** Service account the push subscription signs as. Checked when set. */
  serviceAccountEmail?: string;
  /** Shared secret expected in `?token=` when OIDC is not configured. */
  sharedToken?: string;
};

export function pushAuthConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PushAuthConfig {
  return {
    audience: env.GOOGLE_PLAY_RTDN_AUDIENCE || undefined,
    serviceAccountEmail: env.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT || undefined,
    sharedToken: env.GOOGLE_PLAY_RTDN_TOKEN || undefined,
  };
}

export type PushAuthResult = { ok: true } | { ok: false; status: 401 | 503; reason: string };

export class GoogleCertCache {
  private keys: Map<string, Jwk> = new Map();
  private expiresAt = 0;
  constructor(
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
    private readonly now: () => number = Date.now,
  ) {}

  async get(kid: string): Promise<Jwk | undefined> {
    if (this.now() >= this.expiresAt || !this.keys.has(kid)) {
      await this.refresh();
    }
    return this.keys.get(kid);
  }

  private async refresh(): Promise<void> {
    const res = await this.fetchImpl(GOOGLE_CERTS_URL);
    if (!res.ok) throw new Error(`Fetching Google certs failed (${res.status})`);
    const body = (await res.json()) as { keys?: Jwk[] };
    const maxAge = /max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1];
    this.keys = new Map((body.keys ?? []).filter((k) => k.kid).map((k) => [k.kid as string, k]));
    this.expiresAt = this.now() + (maxAge ? Number(maxAge) * 1000 : 3_600_000);
  }
}

function decodeJson(segment: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export async function verifyGoogleOidcToken(
  jwt: string,
  expected: { audience: string; email?: string },
  certs: GoogleCertCache,
  now: () => number = Date.now,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const parts = jwt.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed token" };
  const [headerB64, payloadB64, signatureB64] = parts;
  const header = decodeJson(headerB64);
  const payload = decodeJson(payloadB64);
  if (!header || !payload) return { ok: false, reason: "malformed token" };
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    return { ok: false, reason: "unsupported token algorithm" };
  }

  const jwk = await certs.get(header.kid);
  if (!jwk) return { ok: false, reason: "unknown signing key" };
  const valid = verify(
    "RSA-SHA256",
    Buffer.from(`${headerB64}.${payloadB64}`),
    createPublicKey({ key: jwk, format: "jwk" }),
    Buffer.from(signatureB64, "base64url"),
  );
  if (!valid) return { ok: false, reason: "bad signature" };

  const nowSeconds = Math.floor(now() / 1000);
  if (typeof payload.iss !== "string" || !GOOGLE_ISSUERS.has(payload.iss)) {
    return { ok: false, reason: "wrong issuer" };
  }
  if (payload.aud !== expected.audience) return { ok: false, reason: "wrong audience" };
  if (typeof payload.exp !== "number" || payload.exp + CLOCK_SKEW_SECONDS < nowSeconds) {
    return { ok: false, reason: "token expired" };
  }
  if (typeof payload.iat === "number" && payload.iat - CLOCK_SKEW_SECONDS > nowSeconds) {
    return { ok: false, reason: "token issued in the future" };
  }
  if (expected.email) {
    if (payload.email !== expected.email || payload.email_verified !== true) {
      return { ok: false, reason: "wrong service account" };
    }
  }
  return { ok: true };
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function authenticatePush(
  request: { authorization?: string; queryToken?: unknown },
  config: PushAuthConfig,
  certs: GoogleCertCache,
  now: () => number = Date.now,
): Promise<PushAuthResult> {
  if (config.audience) {
    const match = /^Bearer (.+)$/.exec(request.authorization ?? "");
    if (!match) return { ok: false, status: 401, reason: "missing bearer token" };
    const result = await verifyGoogleOidcToken(
      match[1],
      { audience: config.audience, email: config.serviceAccountEmail },
      certs,
      now,
    );
    return result.ok ? result : { ok: false, status: 401, reason: result.reason };
  }
  if (config.sharedToken) {
    const token = typeof request.queryToken === "string" ? request.queryToken : "";
    return safeEqual(token, config.sharedToken)
      ? { ok: true }
      : { ok: false, status: 401, reason: "bad push token" };
  }
  return { ok: false, status: 503, reason: "RTDN endpoint auth is not configured" };
}
