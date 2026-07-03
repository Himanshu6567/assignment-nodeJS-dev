import type { ResultSetHeader } from "mysql2/promise";
import { env } from "../config/env.ts";
import { pool } from "../db/client.ts";
import type { TransactionPayload } from "../types/transaction.ts";

export type ProcessTransactionResult = "processed" | "duplicate";

const toMysqlDateTime = (isoTimestamp: string): string =>
  new Date(isoTimestamp).toISOString().slice(0, 23).replace("T", " ");

export const processTransaction = async (
  tx: TransactionPayload,
): Promise<ProcessTransactionResult> => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [processed] = await connection.execute<ResultSetHeader>(
      `
        INSERT IGNORE INTO processed_transactions (id)
        VALUES (?)
      `,
      [tx.id],
    );

    if (processed.affectedRows === 0) {
      await connection.commit();
      return "duplicate";
    }

    await connection.execute(
      `
        INSERT INTO wallets (user_id, balance)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE user_id = user_id
      `,
      [tx.userId, env.defaultWalletBalance],
    );

    await connection.execute(
      `
        UPDATE wallets
        SET balance = balance - ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
      `,
      [tx.amount, tx.userId],
    );

    await connection.execute(
      `
        INSERT INTO transactions (id, user_id, amount, currency, occurred_at)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE id = id
      `,
      [tx.id, tx.userId, tx.amount, tx.currency, toMysqlDateTime(tx.timestamp)],
    );

    await connection.commit();
    return "processed";
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};
