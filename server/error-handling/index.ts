import {
  NextFunction,
  Request,
  Response,
  ErrorRequestHandler,
  Application,
} from "express";

interface MongoError extends Error {
  code?: number;
  keyPattern?: Record<string, unknown>;
  keyValue?: Record<string, unknown>;
}

function isMongoError(error: unknown): error is MongoError {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: string }).name ?? "";
  return (
    name === "MongoServerError" ||
    name === "MongoError" ||
    name === "MongoWriteConcernError"
  );
}

export function classifyMongoError(
  error: unknown
): { status: number; message: string; code: string } | null {
  if (!isMongoError(error)) return null;

  if (error.code === 11000) {
    const field = error.keyPattern ? Object.keys(error.keyPattern)[0] : "field";
    return {
      status: 409,
      code: "DUPLICATE_KEY",
      message: `A record with that ${field} already exists.`,
    };
  }

  return null;
}

export const addErrorHandlingToApp = (app: Application) => {
  app.use((_: Request, res: Response, _next: NextFunction) => {
    res.status(404).json({ message: "This route does not exist" });
  });

  app.use(((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const mongoClassification = classifyMongoError(err);
    if (mongoClassification) {
      console.warn(
        `[${req.method} ${req.path}] MongoDB ${mongoClassification.code}:`,
        (err as MongoError).keyValue
      );

      if (!res.headersSent) {
        return res.status(mongoClassification.status).json({
          code: mongoClassification.code,
          message: mongoClassification.message,
        });
      }

      return;
    }

    console.error(`[${req.method} ${req.path}] Unhandled error:`, err);

    if (!res.headersSent) {
      res.status(500).json({
        code: "INTERNAL_ERROR",
        message: "Internal server error. Check the server console.",
      });
    }
  }) as ErrorRequestHandler);
};

export default addErrorHandlingToApp;
