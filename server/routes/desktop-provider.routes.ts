import { fromNodeHeaders } from "better-auth/node";
import express from "express";
import { auth } from "../auth/auth";
import { signSessionToken } from "../auth/bearerSession";
import {
  DEFAULT_EXCHANGE_TTL_SEC,
  generateCode,
  getExchangeCodeStore,
} from "../auth/desktopExchangeStore";
import { verifySessionToken } from "../auth/desktopSessionManager";
import { desktopSessionStore } from "../auth/desktopSessionStore";

const PROVIDERS = new Set(["github", "google", "discord", "apple", "steam"]);
const STATE_RE = /^[A-Za-z0-9_-]{16,128}$/;
const TTL = 600;
type NativeFlow = {
  state: string;
  codeChallenge?: string;
  userId?: string;
  sourceSessionId?: string;
};

const router = express.Router();
const errorLink = (state: string, reason: string) =>
  `tiao://auth/error?${new URLSearchParams({ state, reason })}`;

/** Only this server-side API call may attach a native callback to a Steam flow. */
async function startSteam(headers: Headers, callbackURL: string, linking: boolean) {
  const api = auth.api as unknown as {
    steamStart(input: {
      headers: Headers;
      body: Record<string, unknown>;
      asResponse: true;
    }): Promise<globalThis.Response>;
  };
  return api.steamStart({
    headers,
    body: {
      intent: linking ? "link" : "sign-in",
      nativeCallback: callbackURL,
      returnPath: "/en/play",
    },
    asResponse: true,
  });
}

export async function startDesktopSteam(state: string, codeChallenge?: string) {
  const ticket = generateCode();
  await getExchangeCodeStore().put(
    `native-flow:${ticket}`,
    ticket,
    JSON.stringify({ state, codeChallenge }),
    TTL,
  );
  return startSteam(
    new Headers(),
    `/api/auth/desktop/flow/callback?ticket=${encodeURIComponent(ticket)}`,
    false,
  );
}

router.post("/link/start", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const { provider, state } = req.body ?? {};
  if (!PROVIDERS.has(provider) || typeof state !== "string" || !STATE_RE.test(state))
    return res.status(400).json({ message: "Invalid provider or state." });
  try {
    const token = req.headers.authorization?.replace(/^Bearer /i, "");
    const identity = await verifySessionToken(token);
    if (!identity) return res.status(401).json({ message: "Sign in before linking an account." });
    const row = await desktopSessionStore.read(identity.sessionId);
    if (!row) return res.status(401).json({ message: "Session expired." });
    // Resolve the originating Better Auth session only after verifying the
    // desktop token. It stays server-side, never in the renderer or a URL.
    const ctx = await auth.$context;
    const source = await ctx.adapter.findOne<{ token: string }>({
      model: "session",
      where: [{ field: "id", value: row.sourceSessionId }],
    });
    if (!source) return res.status(401).json({ message: "Session expired." });
    const headers = new Headers({
      authorization: `Bearer ${signSessionToken(source.token, ctx.secret)}`,
    });
    const ticket = generateCode();
    const callbackURL = `/api/auth/desktop/flow/callback?ticket=${encodeURIComponent(ticket)}`;
    const response =
      provider === "steam"
        ? await startSteam(headers, callbackURL, true)
        : await auth.api.linkSocialAccount({
            headers,
            body: {
              provider,
              callbackURL,
              errorCallbackURL: `${callbackURL}&failed=1`,
              disableRedirect: true,
            },
            asResponse: true,
          });
    const body = (await response.json()) as { url?: string; message?: string };
    if (!response.ok || !body.url)
      return res
        .status(response.ok ? 500 : response.status)
        .json({ message: body.message || "Could not start linking." });
    await getExchangeCodeStore().put(
      `native-flow:${ticket}`,
      ticket,
      JSON.stringify({
        state,
        userId: identity.userId,
        sourceSessionId: row.sourceSessionId,
      } satisfies NativeFlow),
      TTL,
    );
    await getExchangeCodeStore().put(
      `native-begin:${state}`,
      ticket,
      JSON.stringify({ url: body.url, cookies: response.headers.getSetCookie() }),
      120,
    );
    return res.json({
      path: `/api/auth/desktop/link/begin?${new URLSearchParams({ state, ticket })}`,
    });
  } catch {
    return res.status(503).json({ message: "Could not start linking. Please try again." });
  }
});

router.get("/link/begin", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  const { state, ticket } = req.query;
  if (typeof state !== "string" || !STATE_RE.test(state) || typeof ticket !== "string")
    return res.status(400).send("Invalid link request.");
  try {
    const stored = await getExchangeCodeStore().consume(`native-begin:${state}`, ticket);
    if (!stored) return res.redirect(errorLink(state, "link_expired"));
    const { url, cookies } = JSON.parse(stored) as { url: string; cookies: string[] };
    for (const cookie of cookies) res.append("set-cookie", cookie);
    return res.redirect(url);
  } catch {
    return res.redirect(errorLink(state, "server_error"));
  }
});

router.get("/flow/callback", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  const ticket = req.query.ticket;
  if (typeof ticket !== "string") return res.status(400).send("Missing ticket.");
  const stored = await getExchangeCodeStore().consume(`native-flow:${ticket}`, ticket);
  if (!stored) return res.status(400).send("Sign-in expired. Please try again from the app.");
  const flow = JSON.parse(stored) as NativeFlow;
  if (req.query.error || req.query.failed) {
    const reason =
      typeof req.query.error === "string" && /^[a-z0-9_]{1,64}$/.test(req.query.error)
        ? req.query.error
        : "link_failed";
    return res.redirect(errorLink(flow.state, reason));
  }
  try {
    // Linking uses the app's original account. A different browser login
    // must never choose the account to link or replace the app identity.
    let { userId, sourceSessionId } = flow;
    if (!userId) {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
      if (!session || session.user.isAnonymous)
        return res.redirect(errorLink(flow.state, "no_session"));
      userId = session.user.id;
      sourceSessionId = session.session.id;
    }
    if (!sourceSessionId) return res.redirect(errorLink(flow.state, "no_session"));
    const securityState = await desktopSessionStore.securityState(userId, sourceSessionId);
    if (!securityState) return res.redirect(errorLink(flow.state, "no_session"));
    const code = generateCode();
    await getExchangeCodeStore().put(
      flow.state,
      code,
      JSON.stringify({
        userId,
        sourceSessionId,
        securityState,
        codeChallenge: flow.codeChallenge,
      }),
      DEFAULT_EXCHANGE_TTL_SEC,
    );
    return res.redirect(`tiao://auth/complete?${new URLSearchParams({ state: flow.state, code })}`);
  } catch {
    return res.redirect(errorLink(flow.state, "server_error"));
  }
});

export default router;
