import express from "express";
import { Express } from "express";
import logger from "morgan";
import cors from "cors";
import helmet from "helmet";
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
  if (!requestOrigin) return callback(null, true);

  if (requestOrigin === DESKTOP_ORIGIN) return callback(null, true);

  if (FRONTEND_URL && requestOrigin === FRONTEND_URL) {
    return callback(null, true);
  }

  // Dev-only: accept any localhost origin.  In production with
  // FRONTEND_URL set, this branch is not reached.
  if (!FRONTEND_URL && process.env.NODE_ENV !== "production") {
    if (/^https?:\/\/localhost(:\d+)?$/.test(requestOrigin)) {
      return callback(null, true);
    }
  }

  return callback(null, false);
}

export const configureApp = (app: Express): void => {
  app.set("trust proxy", 1);

  app.use(helmet());

  app.use(
    cors({
      origin: corsOriginPredicate,
      credentials: true,
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
