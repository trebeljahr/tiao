import cors from "cors";
import type { NextFunction, Request, Response } from "express";
import { MOBILE_ORIGINS } from "../lib/wsOrigin";

/**
 * CORS for better-auth's endpoints, for the native mobile WebViews only.
 *
 * The web client reaches /api/auth/* same-origin through its proxy and
 * needs no CORS. The Capacitor apps call it cross-origin with
 * `Authorization: Bearer` (no cookies, so no credentials) and must be able
 * to read the `set-auth-token` response header the bearer plugin adds.
 * Requests from any other origin pass through untouched, exactly as before.
 */
const allowNative = cors({
  origin: [...MOBILE_ORIGINS],
  credentials: false,
  exposedHeaders: ["set-auth-token"],
});

export function nativeAuthCors(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (!origin || !MOBILE_ORIGINS.includes(origin)) {
    next();
    return;
  }
  allowNative(req, res, next);
}
