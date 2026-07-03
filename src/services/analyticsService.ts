import type { RowDataPacket } from "mysql2/promise";
import { pool } from "../db/client.ts";
import type { AnalyticsSummary } from "../types/transaction.ts";

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

type NumberLike = number | string;

type TotalsRow = RowDataPacket & {
  total_volume: NumberLike | null;
  transaction_count: NumberLike;
};

type CurrencyRow = RowDataPacket & {
  currency: string;
  total_volume: NumberLike;
  transaction_count: NumberLike;
};

type UserRow = RowDataPacket & {
  user_id: string;
  total_volume: NumberLike;
  transaction_count: NumberLike;
};

export const computeAnalyticsSummary =
  async (): Promise<AnalyticsSummary> => {
    console.log("Analytics cache miss: computing summary from database");
    await delay(2000);

    const [totalsResult, currencyResult, usersResult] = await Promise.all([
      pool.query<TotalsRow[]>(
        `
          SELECT
            COALESCE(SUM(amount), 0) AS total_volume,
            COUNT(*) AS transaction_count
          FROM transactions
        `,
      ),
      pool.query<CurrencyRow[]>(
        `
          SELECT
            currency,
            COALESCE(SUM(amount), 0) AS total_volume,
            COUNT(*) AS transaction_count
          FROM transactions
          GROUP BY currency
          ORDER BY total_volume DESC
        `,
      ),
      pool.query<UserRow[]>(
        `
          SELECT
            user_id,
            COALESCE(SUM(amount), 0) AS total_volume,
            COUNT(*) AS transaction_count
          FROM transactions
          GROUP BY user_id
          ORDER BY total_volume DESC
          LIMIT 5
        `,
      ),
    ]);

    const totalsRows = totalsResult[0];
    const currencyRows = currencyResult[0];
    const userRows = usersResult[0];
    const totals = totalsRows[0] ?? {
      total_volume: "0",
      transaction_count: "0",
    };

    return {
      generatedAt: new Date().toISOString(),
      totalTransactions: Number(totals.transaction_count),
      totalVolume: Number(totals.total_volume ?? 0),
      volumeByCurrency: currencyRows.map((row) => ({
        currency: row.currency,
        totalVolume: Number(row.total_volume),
        transactionCount: Number(row.transaction_count),
      })),
      topUsers: userRows.map((row) => ({
        userId: row.user_id,
        totalVolume: Number(row.total_volume),
        transactionCount: Number(row.transaction_count),
      })),
    };
  };
