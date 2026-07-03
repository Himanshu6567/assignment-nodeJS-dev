import { Router } from "express";
import { ingestionRateLimiter } from "../middleware/rateLimiter.ts";
import { transactionQueue } from "../queue/queue.ts";
import { transactionSchema } from "../types/transaction.ts";
import type { Request, Response, NextFunction } from "express";

export const transactionsRouter = Router();

transactionsRouter.post(
  "/",
  ingestionRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const payload = transactionSchema.parse(req.body);
      const existingJob = await transactionQueue.getJob(payload.id);

      if (existingJob) {
        const state = await existingJob.getState();

        if (state !== "failed") {
          res.status(200).json({
            accepted: false,
            duplicate: true,
            transactionId: payload.id,
            queueState: state,
            message: "Transaction id was already submitted.",
          });
          return;
        }

        await existingJob.remove();
      }

      await transactionQueue.add("process-transaction", payload, {
        jobId: payload.id,
      });

      res.status(202).json({
        accepted: true,
        transactionId: payload.id,
        requeued: existingJob ? true : undefined,
      });
    } catch (error) {
      next(error);
    }
  },
);
