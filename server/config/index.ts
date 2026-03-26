import express from "express";
import { Express } from "express";
import logger from "morgan";
import cors from "cors";
import helmet from "helmet";
import { FRONTEND_URL } from "./envVars";

export const configureApp = (app: Express): void => {
  app.set("trust proxy", 1);

  app.use(helmet());

  app.use(
    cors({
      origin: FRONTEND_URL ? [FRONTEND_URL] : false,
      credentials: true,
    })
  );

  const isProduction = process.env.NODE_ENV === "production";
  app.use(logger(isProduction ? "combined" : "dev"));
  app.use(express.json());
};
