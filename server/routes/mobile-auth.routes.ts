import express, { type Request, type Response } from "express";
import { auth } from "../auth/auth";
import { generateCode, getExchangeCodeStore } from "../auth/desktopExchangeStore";
import { isValidDesktopProvider } from "./desktop-auth.routes";

/**
 * Account linking for the native mobile apps.
 *
 * better-auth's linkSocial needs the signed-in user's session and leaves an
 * OAuth state cookie that must be present when the provider redirects back.
 * The app holds its session as a bearer token, and the provider flow has to
 * run in the system browser (Google refuses embedded WebViews), which has
 * neither. So the link runs in three steps, like social sign-in:
 *
 *   1. POST /link/start (Authorization: Bearer, from the app): calls
 *      linkSocial as that user, and parks the provider URL and the state
 *      cookies under a one-time ticket (2 minutes, single use).
 *   2. GET /link/begin?state&ticket (system browser): redeems the ticket,
 *      sets the state cookies on the API origin, redirects to the provider.
 *      better-auth's own callback then links the account; it reads the
 *      target user from its server-side OAuth state, not from a cookie.
 *   3. GET /link/callback?tiao_state (system browser): bounces to
 *      tiao://auth/linked?state or tiao://auth/error?state&reason. The app
 *      only refreshes its provider list, so the deep link carries no secret.
 *
 * The ticket is the only credential in a URL. It is single use, short
 * lived, bound to the app-chosen state, and travels only from the app to
 * the browser it opens. The session token itself never appears in a URL.
 */

const router = express.Router();

const LINK_TICKET_TTL_SEC = 120;
const STATE_RE = /^[A-Za-z0-9_-]{16,128}$/;
const REASON_RE = /^[a-z0-9_]{1,64}$/;

function ticketKey(state: string): string {
  return `link:${state}`;
}

export function isValidLinkState(state: unknown): state is string {
  return typeof state === "string" && STATE_RE.test(state);
}

function deepLinkError(state: string, reason: string): string {
  const safeReason = REASON_RE.test(reason) ? reason : "link_failed";
  return `tiao://auth/error?state=${encodeURIComponent(state)}&reason=${safeReason}`;
}

router.post("/link/start", async (req: Request, res: Response) => {
  const authorization = req.headers.authorization;
  if (typeof authorization !== "string" || !/^bearer /i.test(authorization)) {
    return res.status(401).json({ code: "NOT_AUTHENTICATED", message: "Not authenticated." });
  }
  const { provider, state } = (req.body ?? {}) as { provider?: unknown; state?: unknown };
  if (!isValidDesktopProvider(provider)) {
    return res.status(400).json({ code: "INVALID_PROVIDER", message: "Unknown provider." });
  }
  if (!isValidLinkState(state)) {
    return res.status(400).json({ code: "INVALID_STATE", message: "Invalid state." });
  }

  try {
    const headers = new Headers({ authorization });
    const session = await auth.api.getSession({ headers });
    if (!session) {
      return res.status(401).json({ code: "NOT_AUTHENTICATED", message: "Not authenticated." });
    }
    if ((session.user as { isAnonymous?: boolean | null }).isAnonymous) {
      return res.status(403).json({
        code: "ACCOUNT_REQUIRED",
        message: "Only account players can link a provider.",
      });
    }

    const callback = `/api/auth/mobile/link/callback?tiao_state=${encodeURIComponent(state)}`;
    const baResponse = (await auth.api.linkSocialAccount({
      headers,
      body: {
        provider: provider as "google" | "github" | "discord" | "apple",
        callbackURL: callback,
        errorCallbackURL: `${callback}&failed=1`,
        disableRedirect: true,
      },
      asResponse: true,
    })) as globalThis.Response;
    const body = (await baResponse.json().catch(() => ({}))) as {
      url?: string;
      code?: string;
      message?: string;
    };
    if (!baResponse.ok || typeof body.url !== "string" || !body.url) {
      return res.status(baResponse.ok ? 500 : baResponse.status).json({
        code: body.code || "LINK_START_FAILED",
        message: body.message || "Could not start linking.",
      });
    }

    const ticket = generateCode();
    await getExchangeCodeStore().put(
      ticketKey(state),
      ticket,
      JSON.stringify({ url: body.url, cookies: baResponse.headers.getSetCookie() }),
      LINK_TICKET_TTL_SEC,
    );
    const params = new URLSearchParams({ state, ticket });
    return res.json({ path: `/api/auth/mobile/link/begin?${params.toString()}` });
  } catch (err) {
    console.error("[mobile-auth] /link/start failed:", err);
    return res.status(500).json({ code: "LINK_START_FAILED", message: "Could not start linking." });
  }
});

router.get("/link/begin", async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  // Keep the ticket out of the Referer sent to the provider.
  res.setHeader("Referrer-Policy", "no-referrer");
  const state = req.query.state;
  const ticket = req.query.ticket;
  if (!isValidLinkState(state) || typeof ticket !== "string" || !ticket) {
    return res.status(400).send("Invalid link request.");
  }
  try {
    const stored = await getExchangeCodeStore().consume(ticketKey(state), ticket);
    if (!stored) return res.redirect(deepLinkError(state, "link_expired"));
    const { url, cookies } = JSON.parse(stored) as { url?: unknown; cookies?: unknown };
    if (typeof url !== "string" || !/^https?:\/\//.test(url)) {
      return res.redirect(deepLinkError(state, "server_error"));
    }
    if (Array.isArray(cookies)) {
      for (const cookie of cookies)
        if (typeof cookie === "string") res.append("set-cookie", cookie);
    }
    return res.redirect(url);
  } catch (err) {
    console.error("[mobile-auth] /link/begin failed:", err);
    return res.redirect(deepLinkError(state, "server_error"));
  }
});

router.get("/link/callback", (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const state = req.query.tiao_state;
  if (!isValidLinkState(state)) return res.status(400).send("Missing state");
  const error = typeof req.query.error === "string" ? req.query.error : "";
  if (req.query.failed !== undefined || error) {
    return res.redirect(deepLinkError(state, error || "link_failed"));
  }
  return res.redirect(`tiao://auth/linked?state=${encodeURIComponent(state)}`);
});

export default router;
