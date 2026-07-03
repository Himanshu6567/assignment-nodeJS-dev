import { Router } from "express";
import { env } from "../config/env.ts";
import { createRedisClient } from "../queue/queue.ts";
import { computeAnalyticsSummary } from "../services/analyticsService.ts";
import { getWithStampedeProtection } from "../services/cacheService.ts";
import type { Request, Response,NextFunction } from "express";


const cache = createRedisClient();

export const analyticsRouter = Router();

analyticsRouter.get("/summary", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const summary = await getWithStampedeProtection(
      cache,
      "analytics:summary",
      env.analyticsCacheTtlSeconds,
      computeAnalyticsSummary,
    );

    res.json(summary);
  } catch (error) {
    next(error);
  }
});

export const closeAnalyticsCache = async (): Promise<void> => {
  await cache.quit();
};
