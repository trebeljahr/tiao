import express, { Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth/auth";
import { createSessionToken, verifySessionToken } from "../auth/desktopSessionManager";
import {
  getExchangeCodeStore,
  generateCode,
  DEFAULT_EXCHANGE_TTL_SEC,
} from "../auth/desktopExchangeStore";

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
 *      consumes the entry and returns a self-contained bearer token
 *      minted via desktopSessionManager.
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

const ALLOWED_PROVIDERS = new Set(["google", "github", "discord"]);
const SESSION_TOKEN_TTL_DAYS = 30;

export function isValidDesktopProvider(provider: unknown): provider is string {
  return typeof provider === "string" && ALLOWED_PROVIDERS.has(provider);
}

const router = express.Router();

// -----------------------------------------------------------------------------
// GET /api/auth/desktop/start?provider=<google|github|discord>&state=<UUID>
//
// Kicks off the OAuth flow in the system browser.
// -----------------------------------------------------------------------------
router.get("/start", async (req: Request, res: Response) => {
  try {
    const provider = req.query.provider;
    const state = req.query.state;

    if (!isValidDesktopProvider(provider)) {
      return res.status(400).json({
        code: "INVALID_PROVIDER",
        message: "provider must be one of: google, github, discord",
      });
    }
    if (typeof state !== "string" || state.length === 0 || state.length > 256) {
      return res.status(400).json({
        code: "INVALID_STATE",
        message: "state is required (UUID from the desktop client)",
      });
    }

    // better-auth's social sign-in accepts a callbackURL that it will
    // redirect to once the OAuth round-trip finishes.  Echo the
    // desktop-provided state through the query string so /callback
    // can recover it.
    const callbackURL = `/api/auth/desktop/callback?tiao_state=${encodeURIComponent(state)}`;

    const baResponse = await auth.api.signInSocial({
      body: {
        provider: provider as "google" | "github" | "discord",
        callbackURL,
      },
      asResponse: true,
    });

    // Forward any Set-Cookie headers better-auth set for CSRF state
    // (these are critical — without them the OAuth callback will
    // fail verification when the user returns).
    const setCookie = baResponse.headers.get("set-cookie");
    if (setCookie) {
      res.setHeader("set-cookie", setCookie);
    }

    if (!baResponse.ok) {
      console.error("[desktop-auth] /start: better-auth rejected sign-in", baResponse.status);
      return res.status(500).json({
        code: "OAUTH_INIT_FAILED",
        message: "Could not start the OAuth flow.",
      });
    }

    const body = (await baResponse.json()) as { url?: string; redirect?: boolean };
    if (!body || !body.redirect || typeof body.url !== "string") {
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

  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session) {
      // OAuth flow failed or cookie didn't stick — bounce the desktop
      // app back to an error handler URL it can parse.
      return res.redirect(`tiao://auth/error?state=${encodeURIComponent(state)}&reason=no_session`);
    }

    const userId = session.user.id;
    const code = generateCode();
    await getExchangeCodeStore().put(state, code, userId, DEFAULT_EXCHANGE_TTL_SEC);

    return res.redirect(
      `tiao://auth/complete?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`,
    );
  } catch (err) {
    console.error("[desktop-auth] /callback failed:", err);
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
router.post("/exchange", async (req: Request, res: Response) => {
  try {
    const { state, code } = (req.body ?? {}) as { state?: unknown; code?: unknown };
    if (typeof state !== "string" || !state || typeof code !== "string" || !code) {
      return res.status(400).json({
        code: "BAD_REQUEST",
        message: "state and code are required",
      });
    }

    const userId = await getExchangeCodeStore().consume(state, code);
    if (!userId) {
      return res.status(401).json({
        code: "EXCHANGE_FAILED",
        message: "That exchange code is invalid or has expired.",
      });
    }

    const sessionToken = createSessionToken(userId, SESSION_TOKEN_TTL_DAYS);
    // Payload's expiresAt is the authoritative source, but clients
    // find it convenient to have it separately so they can schedule
    // refreshes without parsing the opaque token.
    const expiresAt = Date.now() + SESSION_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

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
// again.  Rejects expired / tampered tokens.
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

    const payload = verifySessionToken(sessionToken);
    if (!payload) {
      return res.status(401).json({
        code: "INVALID_TOKEN",
        message: "That session token is invalid or has expired.",
      });
    }

    const newToken = createSessionToken(payload.userId, SESSION_TOKEN_TTL_DAYS);
    const expiresAt = Date.now() + SESSION_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
    return res.json({ sessionToken: newToken, userId: payload.userId, expiresAt });
  } catch (err) {
    console.error("[desktop-auth] /refresh failed:", err);
    return res.status(500).json({
      code: "REFRESH_FAILED",
      message: "Could not refresh the session token.",
    });
  }
});

export default router;
