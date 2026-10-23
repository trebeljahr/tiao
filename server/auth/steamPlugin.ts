import type { BetterAuthPlugin, GenericEndpointContext } from "better-auth";
import { APIError, createAuthEndpoint, getSessionFromCtx } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { FRONTEND_URL } from "../config/envVars";
import {
  createSteamAccount,
  findSteamAccount,
  linkSteamAccount,
  SteamAccountError,
} from "./steamAccount";
import {
  readSteamFlow,
  steamAuthorizationUrl,
  steamProof,
  steamReturnPath,
  storeSteamFlow,
  verifySteamOpenId,
} from "./steamOpenId";
import { fetchSteamProfile } from "./steamProfile";

// Manual field validation below keeps the plugin independent of a schema library.
const objectBody = {
  "~standard": {
    version: 1 as const,
    vendor: "tiao",
    validate: (value: unknown) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? { value: value as Record<string, unknown> }
        : { issues: [{ message: "Expected a JSON object." }] },
  },
};

function requireBrowserOrigin(ctx: GenericEndpointContext) {
  const origin = ctx.request?.headers.get("origin");
  // These cookie-based browser endpoints deliberately require an Origin even
  // for first login. Do not rely on test-mode/default CSRF skip behavior.
  if (
    !origin ||
    origin === "null" ||
    !ctx.context.isTrustedOrigin(origin, { allowRelativePaths: false })
  ) {
    throw new APIError("FORBIDDEN", { message: "Invalid sign-in origin." });
  }
}

async function setSteamBrowserSession(ctx: GenericEndpointContext, userId: string) {
  const previous = await getSessionFromCtx(ctx);
  const user = await ctx.context.internalAdapter.findUserById(userId);
  if (!user || (user as { isAnonymous?: boolean }).isAnonymous)
    throw new Error("Account unavailable");
  const session = await ctx.context.internalAdapter.createSession(user.id);
  // Reuse Tiao's configured anonymous-account migration for guest games.
  // Better Auth's anonymous plugin only matches its built-in sign-in paths.
  const anonymous = ctx.context.options.plugins?.find((plugin) => plugin.id === "anonymous");
  const options = anonymous?.options as
    | { onLinkAccount?: unknown; disableDeleteAnonymousUser?: boolean }
    | undefined;
  if (previous?.user.isAnonymous && previous.user.id !== user.id) {
    if (typeof options?.onLinkAccount === "function") {
      await options.onLinkAccount({ anonymousUser: previous, newUser: { user, session }, ctx });
    }
    await setSessionCookie(ctx, { user, session });
    if (!options?.disableDeleteAnonymousUser) {
      try {
        await ctx.context.internalAdapter.deleteUser(previous.user.id);
      } catch {
        console.warn("[steam-auth] Guest cleanup deferred.");
      }
    }
  } else await setSessionCookie(ctx, { user, session });
}

/** Browser OpenID and native Steam tickets use the same Better Auth provider record. */
export function steamIdentityPlugin(): BetterAuthPlugin {
  return {
    id: "tiao-steam",
    rateLimit: [{ pathMatcher: (path) => path.startsWith("/steam/"), window: 60, max: 20 }],
    endpoints: {
      steamStart: createAuthEndpoint(
        "/steam/start",
        { method: "POST", body: objectBody },
        async (ctx) => {
          requireBrowserOrigin(ctx);
          const body = (ctx.body ?? {}) as Record<string, unknown>;
          const intent = body.intent === "link" ? "link" : "sign-in";
          const current = intent === "link" ? await getSessionFromCtx(ctx) : null;
          if (intent === "link" && (!current || current.user.isAnonymous))
            throw new APIError("UNAUTHORIZED", {
              message: "Sign in to the Tiao account you want to link.",
            });
          const oldPendingCookie = ctx.context.createAuthCookie("steam_pending");
          const oldPending = await ctx.getSignedCookie(oldPendingCookie.name, ctx.context.secret);
          if (typeof oldPending === "string") await readSteamFlow(oldPending, true);
          ctx.setCookie(oldPendingCookie.name, "", { ...oldPendingCookie.attributes, maxAge: 0 });
          const state = steamProof();
          const returnTo = `${ctx.context.baseURL}/steam/callback?state=${encodeURIComponent(state)}`;
          await storeSteamFlow(state, {
            kind: "state",
            returnTo,
            returnPath: steamReturnPath(body.returnPath),
            ...(current
              ? { targetUserId: current.user.id, targetSessionId: current.session.id }
              : {}),
          });
          const cookie = ctx.context.createAuthCookie("steam_state", {
            maxAge: 600,
            sameSite: "lax",
          });
          await ctx.setSignedCookie(cookie.name, state, ctx.context.secret, cookie.attributes);
          return ctx.json({ url: steamAuthorizationUrl(returnTo) });
        },
      ),
      steamCallback: createAuthEndpoint("/steam/callback", { method: "GET" }, async (ctx) => {
        const query = new URL(ctx.request!.url).searchParams;
        const stateCookie = ctx.context.createAuthCookie("steam_state", {
          maxAge: 600,
          sameSite: "lax",
        });
        const state = await ctx.getSignedCookie(stateCookie.name, ctx.context.secret);
        if (typeof state !== "string" || state !== query.get("state"))
          throw new APIError("BAD_REQUEST", {
            message: "Steam sign-in expired. Please try again.",
          });
        const flow = await readSteamFlow(state, true);
        ctx.setCookie(stateCookie.name, "", { ...stateCookie.attributes, maxAge: 0 });
        if (!flow || flow.kind !== "state" || !flow.returnTo)
          throw new APIError("BAD_REQUEST", {
            message: "Steam sign-in expired. Please try again.",
          });
        const redirectError = (reason: string) => {
          const path = new URL(
            flow.returnPath,
            new URL(FRONTEND_URL || ctx.context.baseURL).origin,
          );
          path.searchParams.set("error", reason);
          return ctx.redirect(path.href);
        };
        if (query.get("openid.mode") === "cancel") throw redirectError("steam_cancelled");
        try {
          const steamId = await verifySteamOpenId(query, flow.returnTo);
          let account: { id: string } | null;
          if (flow.targetUserId) {
            const current = await getSessionFromCtx(ctx);
            if (
              !current ||
              current.user.id !== flow.targetUserId ||
              current.session.id !== flow.targetSessionId ||
              current.user.isAnonymous
            )
              throw new Error("Link session changed");
            account = await linkSteamAccount(steamId, current.user.id);
          } else account = await findSteamAccount(steamId);
          if (account) {
            await setSteamBrowserSession(ctx, account.id);
          } else {
            // No permanent account until the player chooses new or existing.
            const pending = steamProof();
            await storeSteamFlow(pending, {
              kind: "pending",
              steamId,
              returnPath: flow.returnPath,
            });
            const cookie = ctx.context.createAuthCookie("steam_pending", {
              maxAge: 600,
              sameSite: "lax",
            });
            await ctx.setSignedCookie(cookie.name, pending, ctx.context.secret, cookie.attributes);
          }
        } catch (error) {
          throw redirectError(
            error instanceof SteamAccountError ? error.code.toLowerCase() : "steam_sign_in_failed",
          );
        }
        throw ctx.redirect(
          new URL(flow.returnPath, new URL(FRONTEND_URL || ctx.context.baseURL).origin).href,
        );
      }),
      steamPending: createAuthEndpoint("/steam/pending", { method: "GET" }, async (ctx) => {
        ctx.setHeader("Cache-Control", "no-store");
        const cookie = ctx.context.createAuthCookie("steam_pending");
        const pending = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
        const flow = typeof pending === "string" ? await readSteamFlow(pending) : null;
        if (!flow || flow.kind !== "pending" || !flow.steamId) return ctx.json({ status: "none" });
        return ctx.json({ status: "needs_setup", profile: await fetchSteamProfile(flow.steamId) });
      }),
      steamFinish: createAuthEndpoint(
        "/steam/finish",
        { method: "POST", body: objectBody },
        async (ctx) => {
          requireBrowserOrigin(ctx);
          const cookie = ctx.context.createAuthCookie("steam_pending");
          const pending = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
          const flow = typeof pending === "string" ? await readSteamFlow(pending) : null;
          if (!flow || flow.kind !== "pending" || !flow.steamId)
            throw new APIError("BAD_REQUEST", {
              message: "Steam setup expired. Sign in with Steam again.",
            });
          const body = (ctx.body ?? {}) as Record<string, unknown>;
          if (body.action === "cancel") {
            await readSteamFlow(pending as string, true);
            ctx.setCookie(cookie.name, "", { ...cookie.attributes, maxAge: 0 });
            return ctx.json({ status: "cancelled" });
          }
          try {
            let account: { id: string } | null;
            if (body.action === "link") {
              const current = await getSessionFromCtx(ctx);
              if (!current || current.user.isAnonymous)
                throw new APIError("UNAUTHORIZED", {
                  message: "Sign in to your existing Tiao account first.",
                });
              account = await linkSteamAccount(flow.steamId, current.user.id);
            } else if (body.action === "create")
              account = await createSteamAccount(flow.steamId, body.username);
            else
              throw new APIError("BAD_REQUEST", {
                message: "Choose new player or existing account.",
              });
            if (!account)
              throw new APIError("BAD_REQUEST", { message: "This account is unavailable." });
            await setSteamBrowserSession(ctx, account.id);
            await readSteamFlow(pending as string, true);
            ctx.setCookie(cookie.name, "", { ...cookie.attributes, maxAge: 0 });
            return ctx.json({ status: "signed_in" });
          } catch (error) {
            if (error instanceof SteamAccountError)
              throw new APIError(error.status === 409 ? "CONFLICT" : "BAD_REQUEST", {
                code: error.code,
                message: error.message,
              });
            throw error;
          }
        },
      ),
    },
  };
}
