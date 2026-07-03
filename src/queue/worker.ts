import { Worker } from "bullmq";
import { closeDb } from "../db/client.ts";
import { bullMqConnection } from "./queue.ts";
import { processTransaction } from "../services/transactionService.ts";
import type { TransactionPayload } from "../types/transaction.ts";

const simulateNetworkDelay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const worker = new Worker<
  TransactionPayload,
  string,
  "process-transaction"
>(
  "transactions",
  async (job) => {
    await simulateNetworkDelay(500);
    const result = await processTransaction(job.data);
    console.log(`Transaction ${job.data.id}: ${result}`);
    return result;
  },
  {
    connection: bullMqConnection,
    concurrency: 10,
  },
);

worker.on("completed", (job) => {
  console.log(`Job ${job.id} completed`);
});

worker.on("failed", (job, error) => {
  console.error(`Job ${job?.id ?? "unknown"} failed`, error);
});

const shutdown = async (): Promise<void> => {
  console.log("Stopping worker...");
  await worker.close();
  await closeDb();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});

console.log("Transaction worker is running");
