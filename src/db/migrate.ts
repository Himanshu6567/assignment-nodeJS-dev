import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { createMysqlOptions, getDatabaseName } from "./client.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

const quoteIdentifier = (value: string): string =>
  `\`${value.replaceAll("`", "``")}\``;

const recreateDatabase = async (): Promise<void> => {
  const databaseName = getDatabaseName();
  const connection = await mysql.createConnection(createMysqlOptions(undefined, false));

  try {
    await connection.query(
      `DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`,
    );
    await connection.query(
      `CREATE DATABASE ${quoteIdentifier(databaseName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    console.log(`Database ${databaseName} recreated`);
  } finally {
    await connection.end();
  }
};

const run = async (): Promise<void> => {
  await recreateDatabase();

  const migration = await readFile(
    join(__dirname, "migrations", "001_init.sql"),
    "utf8",
  );

  const connection = await mysql.createConnection({
    ...createMysqlOptions(),
    multipleStatements: true,
  });

  try {
    await connection.query(migration);
  } finally {
    await connection.end();
  }

  console.log("Database migration completed");
};

run()
  .catch((error: unknown) => {
    console.error("Migration failed", error);
    process.exitCode = 1;
  });
