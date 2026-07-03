import { Queue, type ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../config/env.ts";
import type { TransactionPayload } from "../types/transaction.ts";

export const bullMqConnection: ConnectionOptions = {
  url: env.redisUrl,
  maxRetriesPerRequest: null,
};

export const createRedisClient = (): Redis =>
  new Redis(env.redisUrl, {
    maxRetriesPerRequest: null,
  });

export const transactionQueue = new Queue<
  TransactionPayload,
  string,
  "process-transaction"
>("transactions", {
  connection: bullMqConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 500,
    },
    removeOnComplete: {
      age: 3600,
      count: 1000,
    },
    removeOnFail: {
      age: 86400,
    },
  },
});
