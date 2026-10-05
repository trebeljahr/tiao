import cors from "cors";
import type { Express } from "express";
import express from "express";
import helmet from "helmet";
import logger from "morgan";
import { MOBILE_ORIGINS } from "../lib/wsOrigin";
import { FRONTEND_URL } from "./envVars";

/**
 * The desktop Electron app loads its static bundle from the custom
 * `app://tiao/` protocol, so every API request is cross-origin from
 * the server's perspective.  We add `app://tiao` to the CORS allow
 * list in every environment — the origin is stable and the bearer
 * token path (see auth/sessionHelper.ts) handles authentication
 * without needing cookie credentials to flow across origins.
 */
const DESKTOP_ORIGIN = "app://tiao";

/**
 * Build the CORS origin function.  Order of precedence:
 *   1. `app://tiao` — desktop Electron, accepted in all envs
 *   2. `FRONTEND_URL` — production web origin (or staging override)
 *   3. In dev (no FRONTEND_URL), also accept localhost origins so
 *      the rare case of cross-origin dev fetches (e.g. Storybook,
 *      Swagger UI on a different port) doesn't require code changes.
 */
function corsOriginPredicate(
  requestOrigin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  // Same-origin requests, curl, or node scripts don't send an Origin
  // header — allow them.  CORS only applies to browser cross-origin
  // fetches, so a missing Origin is not a security issue here.
  if (!requestOrigin) {
    callback(null, true);
    return;
  }

  if (requestOrigin === DESKTOP_ORIGIN) {
    callback(null, true);
    return;
  }

  // Capacitor WebView (iOS capacitor://localhost, Android https://localhost).
  // Same reasoning as the desktop origin: requests authenticate with the
  // bearer token, and the SameSite=Lax session cookie never rides along
  // from a localhost page, so allowing the origin grants nothing by itself.
  if (MOBILE_ORIGINS.includes(requestOrigin)) {
    callback(null, true);
    return;
  }

  if (FRONTEND_URL && requestOrigin === FRONTEND_URL) {
    callback(null, true);
    return;
  }

  // Dev-only: accept any localhost origin.  In production with
  // FRONTEND_URL set, this branch is not reached.
  if (!FRONTEND_URL && process.env.NODE_ENV !== "production") {
    if (/^https?:\/\/localhost(:\d+)?$/.test(requestOrigin)) {
      callback(null, true);
      return;
    }
  }

  callback(null, false);
}

export const configureApp = (app: Express): void => {
  app.set("trust proxy", 1);

  app.use(helmet());

  app.use(
    cors({
      origin: corsOriginPredicate,
      credentials: true,
      // Native mobile reads the session token from POST /player/login.
      exposedHeaders: ["set-auth-token"],
    }),
  );

  const isProduction = process.env.NODE_ENV === "production";
  app.use(logger(isProduction ? "combined" : "dev"));
  // Skip JSON body parsing for Stripe webhook (needs raw body for signature verification)
  app.use((req, res, next) => {
    if (req.path.endsWith("/shop/webhook")) {
      next();
    } else {
      express.json({ limit: "100kb" })(req, res, next);
    }
  });
};
