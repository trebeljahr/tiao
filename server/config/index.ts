import express from "express";
import { Express } from "express";
import logger from "morgan";
import cookieParser from "cookie-parser";
import cors from "cors";
import { FRONTEND_URL } from "./envVars";

export const configureApp = (app: Express): void => {
  app.set("trust proxy", 1);
  if (FRONTEND_URL) {
    app.use(
      cors({
        origin: [FRONTEND_URL],
      })
    );
  }

  app.use(logger("dev"));
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
};
