import express from "express";
import { Request, Response, NextFunction } from "express";
import { isDatabaseReady } from "../db";

const router = express.Router();

router.get("/", (_: Request, res: Response, _next: NextFunction) => {
  res.json("All good in here");
});

router.get("/health", (_: Request, res: Response) => {
  const databaseReady = isDatabaseReady();

  res.status(databaseReady ? 200 : 503).json({
    status: databaseReady ? "ok" : "starting",
    database: databaseReady ? "connected" : "disconnected",
  });
});

export default router;
