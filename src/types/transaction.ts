import { z } from "zod";

export const transactionSchema = z.object({
  id: z.string().min(1).max(120),
  userId: z.string().min(1).max(120),
  amount: z.number().positive(),
  currency: z.string().length(3).transform((value) => value.toUpperCase()),
  timestamp: z.string().datetime(),
});

export type TransactionPayload = z.infer<typeof transactionSchema>;

export type AnalyticsSummary = {
  generatedAt: string;
  totalTransactions: number;
  totalVolume: number;
  volumeByCurrency: Array<{
    currency: string;
    totalVolume: number;
    transactionCount: number;
  }>;
  topUsers: Array<{
    userId: string;
    totalVolume: number;
    transactionCount: number;
  }>;
};
