import type { RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { env } from "../config/env.ts";

export const ingestionRateLimiter: RequestHandler = env.rateLimitEnabled
  ? rateLimit({
      windowMs: env.rateLimitWindowMs,
      limit: env.rateLimitMax,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        error: "Too many transaction requests. Please retry shortly.",
      },
    })
  : (_req, _res, next) => {
      next();
    };
