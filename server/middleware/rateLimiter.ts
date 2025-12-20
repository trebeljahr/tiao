import { rateLimit } from "express-rate-limit";

export const rateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

export const userSearchRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 50,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});
