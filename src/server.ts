import express from "express";
import { env } from "./config/env.ts";
import { closeDb } from "./db/client.ts";
import { closeAnalyticsCache } from "./routes/analytics.ts";
import { analyticsRouter } from "./routes/analytics.ts";
import { transactionsRouter } from "./routes/transactions.ts";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.ts";
import { transactionQueue } from "./queue/queue.ts";
import type { Request, Response } from "express";



const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});



app.use("/v1/transactions", transactionsRouter);
app.use("/v1/analytics", analyticsRouter);
app.use(notFoundHandler);
app.use(errorHandler);




const server = app.listen(env.port, () => {
  console.log(`API server running on port ${env.port}`);
});

const shutdown = async (): Promise<void> => {
  console.log("Shutting down API server...");

  server.close(async () => {
    await Promise.all([
      transactionQueue.close(),
      closeAnalyticsCache(),
      closeDb(),
    ]);
    process.exit(0);
  });
};

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});
