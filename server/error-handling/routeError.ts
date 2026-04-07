import type { Request, Response } from "express";
import { GameServiceError } from "../game/gameService";
import { classifyMongoError } from "./index";

/**
 * Shared route-level error handler. Handles GameServiceError, Mongo errors,
 * and falls back to a generic 500 response.
 */
export function handleRouteError(res: Response, error: unknown, fallback: string, req?: Request) {
  if (error instanceof GameServiceError) {
    return res.status(error.status).json({
      code: error.code,
      message: error.message,
    });
  }

  const mongoError = classifyMongoError(error);
  if (mongoError) {
    const context = req ? `[${req.method} ${req.path}]` : "[route]";
    console.warn(`${context} MongoDB ${mongoError.code}:`, error);
    return res.status(mongoError.status).json({
      code: mongoError.code,
      message: mongoError.message,
    });
  }

  const context = req ? `[${req.method} ${req.path}]` : "[route]";
  console.error(`${context} Unhandled error:`, error);
  return res.status(500).json({
    code: "INTERNAL_ERROR",
    message: fallback,
  });
}
