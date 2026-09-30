import crypto from "node:crypto";
import { TOKEN_SECRET } from "../config/envVars";
import { type DesktopSessionStore, desktopSessionStore } from "./desktopSessionStore";

const DAY = 24 * 60 * 60 * 1000;
const TOKEN_TTL = 30 * DAY;
const ABSOLUTE_TTL = 90 * DAY;
export type DesktopSessionPayload = {
  userId: string;
  sessionId: string;
  expiresAt: number;
  nonce: string;
};

/** v1 tokens are deliberately not migrated: fresh OAuth is required. */
export function desktopSessionManager(store: DesktopSessionStore, secret: string, now = Date.now) {
  const sign = (payload: string) =>
    crypto.createHmac("sha256", secret).update(`v2.${payload}`).digest("base64url");
  const encode = (payload: DesktopSessionPayload) => {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `v2.${body}.${sign(body)}`;
  };
  function decode(token: string | undefined | null): DesktopSessionPayload | null {
    if (typeof token !== "string" || token.length > 2048) return null;
    const [version, body, signature, extra] = token.split(".");
    if (version !== "v2" || !body || !signature || extra !== undefined) return null;
    const expected = Buffer.from(sign(body));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
    try {
      const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
      if (
        !p ||
        typeof p.userId !== "string" ||
        !p.userId ||
        typeof p.sessionId !== "string" ||
        !p.sessionId ||
        typeof p.nonce !== "string" ||
        !p.nonce ||
        !Number.isSafeInteger(p.expiresAt)
      )
        return null;
      return p;
    } catch {
      return null;
    }
  }
  async function verifySessionToken(
    token: string | undefined | null,
  ): Promise<DesktopSessionPayload | null> {
    const payload = decode(token);
    if (!payload || payload.expiresAt <= now()) return null;
    try {
      const row = await store.read(payload.sessionId);
      if (
        !row ||
        row.userId !== payload.userId ||
        row.nonce !== payload.nonce ||
        row.expiresAt !== payload.expiresAt ||
        row.absoluteExpiresAt <= now()
      )
        return null;
      if ((await store.securityState(row.userId, row.sourceSessionId)) !== row.securityState) {
        await store.delete(row._id);
        return null;
      }
      return payload;
    } catch {
      return null;
    } // Storage failures never permit authentication.
  }
  async function createSessionToken(
    userId: string,
    sourceSessionId: string,
    expectedSecurityState?: string,
  ): Promise<string> {
    if (!userId || !sourceSessionId) throw new Error("A user and originating session are required");
    const securityState = await store.securityState(userId, sourceSessionId);
    if (
      !securityState ||
      (expectedSecurityState !== undefined && securityState !== expectedSecurityState)
    )
      throw new Error("Originating session is no longer valid");
    const payload = {
      userId,
      sessionId: crypto.randomUUID(),
      nonce: crypto.randomUUID(),
      expiresAt: now() + TOKEN_TTL,
    };
    await store.insert({
      ...payload,
      _id: payload.sessionId,
      sourceSessionId,
      securityState,
      absoluteExpiresAt: now() + ABSOLUTE_TTL,
    });
    return encode(payload);
  }
  async function refreshSessionToken(token: string): Promise<string | null> {
    const payload = await verifySessionToken(token);
    if (!payload) return null;
    const row = await store.read(payload.sessionId);
    if (!row) return null;
    const next = {
      ...payload,
      nonce: crypto.randomUUID(),
      expiresAt: Math.min(now() + TOKEN_TTL, row.absoluteExpiresAt),
    };
    if (
      next.expiresAt <= now() ||
      !(await store.rotate(row._id, payload.nonce, next.nonce, next.expiresAt))
    )
      return null;
    return encode(next);
  }
  async function revokeSessionToken(token: string): Promise<void> {
    const payload = decode(token);
    // Older rotated tokens can still revoke their family (including refresh/logout races).
    if (payload) await store.delete(payload.sessionId);
  }
  async function extractBearerUserId(
    header: string | string[] | undefined,
  ): Promise<string | null> {
    if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
    return (await verifySessionToken(header.slice(7).trim()))?.userId ?? null;
  }
  return {
    createSessionToken,
    verifySessionToken,
    refreshSessionToken,
    revokeSessionToken,
    extractBearerUserId,
  };
}

export const {
  createSessionToken,
  verifySessionToken,
  refreshSessionToken,
  revokeSessionToken,
  extractBearerUserId,
} = desktopSessionManager(desktopSessionStore, TOKEN_SECRET);
