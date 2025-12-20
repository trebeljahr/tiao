import { expressjwt as jwt } from "express-jwt";
import { NextFunction, Request, Response } from "express";

export const jwtMiddleware = jwt({
  secret: process.env.TOKEN_SECRET as string,
  algorithms: ["HS256"],
  getToken: getTokenFromHeaders,
});

export const isAuthenticated = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.auth) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
};

function getTokenFromHeaders(req: Request): string | undefined {
  if (
    req.headers.authorization &&
    req.headers.authorization.split(" ")[0] === "Bearer"
  ) {
    const token = req.headers.authorization.split(" ")[1];
    return token;
  }
}
