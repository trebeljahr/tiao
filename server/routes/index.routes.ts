import express from "express";
import { Request, Response, NextFunction } from "express";

const router = express.Router();

router.get("/", (_: Request, res: Response, next: NextFunction) => {
  res.json("All good in here");
});

export default router;
