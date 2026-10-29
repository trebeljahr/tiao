import { createHash, timingSafeEqual } from "node:crypto";
import { fromNodeHeaders } from "better-auth/node";
import express, { type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { auth } from "../auth/auth";
import * as bearerSession from "../auth/bearerSession";
import { normalizeAuthId } from "../auth/betterAuthIds";
import {
  consumeDesktopCompletion,
  storeDesktopCompletion,
  storeDesktopFailure,
} from "../auth/desktopAuthCompletion";
import {
  DEFAULT_EXCHANGE_TTL_SEC,
  generateCode,
  getExchangeCodeStore,
} from "../auth/desktopExchangeStore";
import {
  createSessionToken,
  refreshSessionToken,
  revokeSessionToken,
  verifySessionToken,
} from "../auth/desktopSessionManager";
import { desktopSessionStore } from "../auth/desktopSessionStore";
import { redirectNativeBrowserToAuthOrigin } from "../auth/nativeBrowserOrigin";
import desktopProviderRoutes, { startDesktopSteam } from "./desktop-provider.routes";

/**
 * OAuth bridge for desktop Electron clients.
 *
 * The desktop app cannot share cookies with the web origin, so web
 * better-auth sessions are invisible to it.  Instead, desktop clients
 * go through this 4-step bridge:
 *
 *   1. Electron opens the system browser at
 *      /api/auth/desktop/start?provider=google&state=<UUID>
 *   2. /start kicks off a normal better-auth social sign-in with a
 *      callbackURL pointing at /api/auth/desktop/callback.  The state
 *      parameter is echoed through the callbackURL query string.
 *   3. After Google -> better-auth callback succeeds, /callback runs
 *      with a valid session cookie, generates a one-time code, stores
 *      (state, code, userId) in the exchange store with 5-min TTL, and
 *      redirects the browser to tiao://auth/complete?state=&code=.
 *   4. Electron's tiao:// protocol handler receives the URL and POSTs
 *      {state, code} to /exchange over HTTPS.  /exchange atomically
 *      consumes the entry and returns a revocable bearer token
 *      minted via desktopSessionManager.
 *
 * Native mobile (Capacitor) uses the same bridge: the app opens /start in
 * the system browser (Google refuses OAuth inside embedded WebViews) and
 * receives the same tiao://auth/complete deep link. Because any app can
 * claim a custom URL scheme on a phone, mobile adds PKCE (RFC 7636): /start
 * takes `code_challenge` (S256), and /exchange then demands the matching
 * `code_verifier`, which never leaves the app. An app that intercepts the
 * deep link holds state + code but not the verifier, so it cannot redeem
 * them. Desktop may send a challenge too; without one the flow is unchanged.
 *
 * /refresh lets long-running desktop sessions renew their token
 * without going through the full OAuth flow again — useful for
 * sessions approaching the 30-day limit.
 *
 * CORS: these routes are mounted BEFORE the global CORS middleware
 * in app.ts (see registerDesktopAuthRoutes) so they work even when
 * called from non-playtiao origins — the Electron app doesn't have
 * a stable browser origin, and /exchange specifically needs to be
 * callable from the Electron main process.
 */

const ALLOWED_PROVIDERS = new Set(["google", "github", "discord", "apple"]);

export function isValidDesktopProvider(provider: unknown): provider is string {
  return typeof provider === "string" && ALLOWED_PROVIDERS.has(provider);
}

/** RFC 7636: S256 challenge = BASE64URL(SHA256(verifier)), 43 chars. */
const CODE_CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
/** RFC 7636 §4.1: 43–128 unreserved characters. */
const CODE_VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;

export function isValidCodeChallenge(value: unknown): value is string {
  return typeof value === "string" && CODE_CHALLENGE_RE.test(value);
}

export function codeChallengeFromVerifier(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function verifierMatchesChallenge(verifier: unknown, challenge: string): boolean {
  if (typeof verifier !== "string" || !CODE_VERIFIER_RE.test(verifier)) return false;
  const actual = Buffer.from(codeChallengeFromVerifier(verifier));
  const expected = Buffer.from(challenge);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const router = express.Router();
router.use(desktopProviderRoutes);

// -----------------------------------------------------------------------------
// GET /api/auth/desktop/start?provider=<google|github|discord>&state=<UUID>
//
// Kicks off the OAuth flow in the system browser.
// -----------------------------------------------------------------------------
router.get("/start", async (req: Request, res: Response) => {
  try {
    const provider = req.query.provider;
    const state = req.query.state;

    if (provider !== "steam" && !isValidDesktopProvider(provider)) {
      return res.status(400).json({
        code: "INVALID_PROVIDER",
        message: "provider must be one of: google, github, discord, apple, steam",
      });
    }
    if (typeof state !== "string" || state.length === 0 || state.length > 256) {
      return res.status(400).json({
        code: "INVALID_STATE",
        message: "state is required (UUID from the desktop client)",
      });
    }

    const challenge = req.query.code_challenge;
    if (challenge !== undefined) {
      if (req.query.code_challenge_method !== "S256" || !isValidCodeChallenge(challenge)) {
        return res.status(400).json({
          code: "INVALID_CODE_CHALLENGE",
          message:
            "code_challenge must be a base64url S256 challenge with code_challenge_method=S256",
        });
      }
    }

    if (await redirectNativeBrowserToAuthOrigin(req, res)) return;

    // better-auth's social sign-in accepts a callbackURL that it will
    // redirect to once the OAuth round-trip finishes.  Echo the
    // desktop-provided state through the query string so /callback
    // can recover it.
    // The challenge rides the same way. better-auth keeps callbackURL in its
    // server-side OAuth state, so nobody in the redirect chain can swap it.
    const callbackURL =
      `/api/auth/desktop/callback?tiao_state=${encodeURIComponent(state)}` +
      (typeof challenge === "string" ? `&tiao_challenge=${encodeURIComponent(challenge)}` : "");

    const baResponse =
      provider === "steam"
        ? await startDesktopSteam(state, typeof challenge === "string" ? challenge : undefined)
        : await auth.api.signInSocial({
            body: {
              provider: provider as "google" | "github" | "discord" | "apple",
              callbackURL,
              errorCallbackURL: new URL(callbackURL, (await auth.$context).baseURL).href,
            },
            asResponse: true,
          });

    // Forward any Set-Cookie headers better-auth set for CSRF state
    // (these are critical — without them the OAuth callback will
    // fail verification when the user returns).
    for (const cookie of baResponse.headers.getSetCookie()) res.append("set-cookie", cookie);

    if (!baResponse.ok) {
      console.error("[desktop-auth] /start: better-auth rejected sign-in", baResponse.status);
      return res.status(500).json({
        code: "OAUTH_INIT_FAILED",
        message: "Could not start the OAuth flow.",
      });
    }

    const body = (await baResponse.json()) as { url?: string; redirect?: boolean };
    if ((provider !== "steam" && !body?.redirect) || typeof body.url !== "string") {
      return res.status(500).json({
        code: "OAUTH_INIT_FAILED",
        message: "Could not start the OAuth flow.",
      });
    }

    return res.redirect(body.url);
  } catch (err) {
    console.error("[desktop-auth] /start failed:", err);
    return res.status(500).json({
      code: "OAUTH_INIT_FAILED",
      message: "Could not start the OAuth flow.",
    });
  }
});

// -----------------------------------------------------------------------------
// GET /api/auth/desktop/callback?tiao_state=<UUID>
//
// Runs after better-auth finishes the OAuth handshake.  Reads the
// freshly-set session cookie, generates a one-time code, stores it in
// the exchange store, and redirects to tiao://auth/complete.
// -----------------------------------------------------------------------------
router.get("/callback", async (req: Request, res: Response) => {
  const state = typeof req.query.tiao_state === "string" ? req.query.tiao_state : "";
  if (!state) {
    return res.status(400).send("Missing state");
  }
  const rawChallenge = req.query.tiao_challenge;
  if (rawChallenge !== undefined && !isValidCodeChallenge(rawChallenge)) {
    return res.redirect(`tiao://auth/error?state=${encodeURIComponent(state)}&reason=bad_request`);
  }
  const codeChallenge = typeof rawChallenge === "string" ? rawChallenge : undefined;
  const fail = async (reason: string) => {
    await storeDesktopFailure(state, reason, codeChallenge);
    return res.redirect(`tiao://auth/error?${new URLSearchParams({ state, reason })}`);
  };

  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session || req.query.error) {
      // OAuth flow failed or cookie didn't stick — bounce the desktop
      // app back to an error handler URL it can parse.
      return await fail("no_session");
    }

    const userId = normalizeAuthId(session.user.id);
    if (!userId) {
      return await fail("no_session");
    }

    const sourceSessionId = session.session.id;
    const securityState = await desktopSessionStore.securityState(userId, sourceSessionId);
    if (!securityState) return await fail("no_session");
    const code = generateCode();
    await getExchangeCodeStore().put(
      state,
      code,
      JSON.stringify({ userId, sourceSessionId, securityState, codeChallenge }),
      DEFAULT_EXCHANGE_TTL_SEC,
    );

    await storeDesktopCompletion(state, code, codeChallenge);

    return res.redirect(
      `tiao://auth/complete?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`,
    );
  } catch (err) {
    console.error("[desktop-auth] /callback failed:", err);
    await storeDesktopFailure(state, "server_error", codeChallenge).catch(() => {});
    return res.redirect(`tiao://auth/error?state=${encodeURIComponent(state)}&reason=server_error`);
  }
});

// -----------------------------------------------------------------------------
// POST /api/auth/desktop/exchange
// Body: { state: string, code: string }
//
// Called by Electron main over HTTPS after receiving the tiao:// URL.
// Atomically consumes the code and mints a real bearer token.
// -----------------------------------------------------------------------------
router.post(
  "/poll",
  rateLimit({ windowMs: 300_000, limit: 300, validate: process.env.NODE_ENV !== "test" }),
  async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const { state, code_verifier: verifier } = req.body ?? {};
    if (
      typeof state !== "string" ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(state) ||
      typeof verifier !== "string" ||
      !CODE_VERIFIER_RE.test(verifier)
    )
      return res.status(400).json({ message: "Invalid sign-in request." });
    try {
      const result = await consumeDesktopCompletion(state, verifier);
      return result
        ? res.json({ code: result.code, reason: result.reason })
        : res.status(202).json({ status: "pending" });
    } catch {
      return res.status(503).json({ message: "Sign-in is temporarily unavailable." });
    }
  },
);

router.post("/exchange", async (req: Request, res: Response) => {
  try {
    const {
      state,
      code,
      code_verifier: codeVerifier,
      token_type: tokenType,
    } = (req.body ?? {}) as {
      state?: unknown;
      code?: unknown;
      code_verifier?: unknown;
      token_type?: unknown;
    };
    if (typeof state !== "string" || !state || typeof code !== "string" || !code) {
      return res.status(400).json({
        code: "BAD_REQUEST",
        message: "state and code are required",
      });
    }
    // Native mobile asks for a better-auth session (token_type "session"),
    // which every better-auth endpoint accepts through the bearer plugin.
    // Desktop omits it and keeps its revocable v2 token.
    if (tokenType !== undefined && tokenType !== "session") {
      return res.status(400).json({
        code: "BAD_REQUEST",
        message: 'token_type must be "session" when present',
      });
    }

    const identity = await getExchangeCodeStore().consume(state, code);
    if (!identity) {
      return res.status(401).json({
        code: "EXCHANGE_FAILED",
        message: "That exchange code is invalid or has expired.",
      });
    }

    const { userId, sourceSessionId, securityState, codeChallenge } = JSON.parse(identity) as {
      userId: string;
      sourceSessionId: string;
      securityState: string;
      codeChallenge?: string;
    };
    // The code is already consumed: a wrong verifier burns it, so an app
    // that intercepted the deep link cannot retry, and cannot win at all.
    if (codeChallenge !== undefined && !verifierMatchesChallenge(codeVerifier, codeChallenge)) {
      return res.status(401).json({
        code: "EXCHANGE_FAILED",
        message: "That exchange code is invalid or has expired.",
      });
    }
    if (
      typeof userId !== "string" ||
      typeof sourceSessionId !== "string" ||
      typeof securityState !== "string"
    ) {
      return res.status(401).json({ code: "EXCHANGE_FAILED" });
    }
    if (tokenType === "session") {
      // Only PKCE flows may receive a full better-auth session: without a
      // verifier, whoever intercepted the deep link could redeem it.
      if (codeChallenge === undefined) {
        return res.status(401).json({ code: "EXCHANGE_FAILED", message: "PKCE is required." });
      }
      const current = await desktopSessionStore.securityState(userId, sourceSessionId);
      if (current !== securityState) return res.status(401).json({ code: "EXCHANGE_FAILED" });
      const minted = await bearerSession.mintBearerSession(userId);
      return res.json({
        sessionToken: minted.token,
        userId,
        expiresAt: minted.expiresAt,
        tokenType: "session",
      });
    }
    const sessionToken = await createSessionToken(userId, sourceSessionId, securityState);
    const payload = await verifySessionToken(sessionToken);
    if (!payload) return res.status(401).json({ code: "EXCHANGE_FAILED" });
    const expiresAt = payload.expiresAt;

    return res.json({ sessionToken, userId, expiresAt });
  } catch (err) {
    console.error("[desktop-auth] /exchange failed:", err);
    return res.status(500).json({
      code: "EXCHANGE_FAILED",
      message: "Could not complete the token exchange.",
    });
  }
});

// -----------------------------------------------------------------------------
// POST /api/auth/desktop/refresh
// Body: { sessionToken: string }
//
// Swaps a valid-but-soon-to-expire bearer token for a fresh one.
// Useful for long-running desktop sessions approaching the 30-day
// lifetime — avoids forcing the user through the full OAuth flow
// again, within the absolute lifetime and originating web session. Rejects
// expired, revoked, rotated, or tampered tokens.
// -----------------------------------------------------------------------------
router.post("/refresh", async (req: Request, res: Response) => {
  try {
    const { sessionToken } = (req.body ?? {}) as { sessionToken?: unknown };
    if (typeof sessionToken !== "string" || !sessionToken) {
      return res.status(400).json({
        code: "BAD_REQUEST",
        message: "sessionToken is required",
      });
    }

    const newToken = await refreshSessionToken(sessionToken);
    const payload = newToken ? await verifySessionToken(newToken) : null;
    if (!payload) {
      return res.status(401).json({
        code: "INVALID_TOKEN",
        message: "That session token is invalid or has expired.",
      });
    }

    const expiresAt = payload.expiresAt;
    return res.json({ sessionToken: newToken, userId: payload.userId, expiresAt });
  } catch (err) {
    console.error("[desktop-auth] /refresh failed:", err);
    return res.status(500).json({
      code: "REFRESH_FAILED",
      message: "Could not refresh the session token.",
    });
  }
});

// Upgrade a password-authenticated session to the desktop's revocable token.
// Electron main calls this with Better Auth's signed set-auth-token response.
router.post("/session", async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  if (!req.headers.authorization?.startsWith("Bearer "))
    return res.status(401).json({ code: "NOT_AUTHENTICATED" });
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    const userId = normalizeAuthId(session?.user.id);
    if (!session || !userId || (session.user as { isAnonymous?: boolean }).isAnonymous)
      return res.status(401).json({ code: "NOT_AUTHENTICATED" });
    const securityState = await desktopSessionStore.securityState(userId, session.session.id);
    if (!securityState) return res.status(401).json({ code: "NOT_AUTHENTICATED" });
    return res.json({
      sessionToken: await createSessionToken(userId, session.session.id, securityState),
      userId,
    });
  } catch {
    return res.status(503).json({ code: "SESSION_UNAVAILABLE" });
  }
});

router.post("/logout", async (req: Request, res: Response) => {
  const token = req.body?.sessionToken;
  if (typeof token !== "string") return res.status(400).json({ code: "BAD_REQUEST" });
  try {
    await revokeSessionToken(token);
    return res.json({ ok: true });
  } catch {
    return res.status(503).json({ code: "REVOCATION_UNAVAILABLE" });
  }
});

export default router;
