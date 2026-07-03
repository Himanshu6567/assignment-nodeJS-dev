import { env } from "../config/env.ts";
import { pool, closeDb } from "./client.ts";

const users = ["user-1", "user-2", "user-3", "user-4", "user-5"];

const run = async (): Promise<void> => {
  for (const userId of users) {
    await pool.query(
      `
        INSERT INTO wallets (user_id, balance)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE
          balance = VALUES(balance),
          updated_at = CURRENT_TIMESTAMP
      `,
      [userId, env.defaultWalletBalance],
    );
  }

  console.log(`Seeded ${users.length} wallets`);
};

run()
  .catch((error: unknown) => {
    console.error("Seed failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
