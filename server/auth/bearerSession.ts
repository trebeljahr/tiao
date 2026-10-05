import { createHmac } from "node:crypto";
import { auth } from "./auth";
import { verifySessionToken } from "./desktopSessionManager";

/**
 * Bearer sessions for the native mobile apps.
 *
 * The Capacitor WebView (capacitor://localhost, https://localhost) cannot
 * keep the API's session cookie: WKWebView and Android WebView both block
 * third-party cookies. The app therefore holds a better-auth session token
 * and sends it as `Authorization: Bearer`. better-auth's `bearer` plugin
 * (see auth.ts) turns that header back into the session cookie for every
 * better-auth endpoint and for `auth.api.getSession`, so sign-up, guests,
 * sign-out, account linking and the app's own REST routes all work with
 * the same token. Only signed tokens are accepted (`requireSignature`).
 *
 * Desktop (Electron) keeps its own revocable v2 tokens from
 * desktopSessionManager. `verifyBearerToken` accepts both kinds, for the
 * WebSocket `?token=` parameter where no header can be sent.
 */

type MintedSession = { token: string; expiresAt: Date };

export type BearerAuth = {
  $context: Promise<{
    secret: string;
    internalAdapter: {
      createSession(userId: string): Promise<MintedSession>;
    };
  }>;
  api: {
    getSession(options: {
      headers: Headers;
      query?: { disableRefresh?: boolean };
    }): Promise<{ user: { id: string } } | null>;
  };
};

const DESKTOP_TOKEN_PREFIX = "v2.";

/**
 * Sign a raw session token the way better-auth signs its session cookie
 * (`<token>.<base64 HMAC-SHA256>`), which is the form the bearer plugin
 * accepts when `requireSignature` is on.
 */
export function signSessionToken(token: string, secret: string): string {
  return `${token}.${createHmac("sha256", secret).update(token).digest("base64")}`;
}

export function isDesktopToken(token: string): boolean {
  return token.startsWith(DESKTOP_TOKEN_PREFIX);
}

export function bearerSessions(
  authInstance: BearerAuth,
  verifyDesktopToken: (token: string) => Promise<{ userId: string } | null>,
) {
  /** Create a fresh better-auth session for `userId` and return its signed token. */
  async function mintBearerSession(userId: string): Promise<{ token: string; expiresAt: number }> {
    const ctx = await authInstance.$context;
    const session = await ctx.internalAdapter.createSession(userId);
    return {
      token: signSessionToken(session.token, ctx.secret),
      expiresAt: new Date(session.expiresAt).getTime(),
    };
  }

  /**
   * Resolve a bearer token from either client to its user id. Returns null
   * for anything invalid, expired, revoked, or on storage errors.
   */
  async function verifyBearerToken(
    token: string | null | undefined,
  ): Promise<{ userId: string } | null> {
    if (typeof token !== "string" || !token || token.length > 2048) return null;
    try {
      if (isDesktopToken(token)) {
        const payload = await verifyDesktopToken(token);
        return payload ? { userId: payload.userId } : null;
      }
      const session = await authInstance.api.getSession({
        headers: new Headers({ authorization: `Bearer ${token}` }),
        query: { disableRefresh: true },
      });
      return session?.user?.id ? { userId: String(session.user.id) } : null;
    } catch {
      return null;
    }
  }

  return { mintBearerSession, verifyBearerToken };
}

const defaultSessions = bearerSessions(auth as unknown as BearerAuth, verifySessionToken);

export const mintBearerSession = (userId: string) => defaultSessions.mintBearerSession(userId);
export const verifyBearerToken = (token: string | null | undefined) =>
  defaultSessions.verifyBearerToken(token);
