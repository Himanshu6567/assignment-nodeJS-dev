import mysql, { type PoolOptions } from "mysql2/promise";
import { env } from "../config/env.ts";

export const getDatabaseName = (databaseUrl = env.databaseUrl): string => {
  const url = new URL(databaseUrl);
  const databaseName = decodeURIComponent(url.pathname.replace("/", ""));

  if (!databaseName) {
    throw new Error("DATABASE_URL must include a database name");
  }

  return databaseName;
};

export const createMysqlOptions = (
  databaseUrl = env.databaseUrl,
  includeDatabase = true,
): PoolOptions => {
  const url = new URL(databaseUrl);
  const databaseName = getDatabaseName(databaseUrl);
  const options: PoolOptions = {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    waitForConnections: true,
    connectionLimit: 10,
    decimalNumbers: true,
  };

  if (includeDatabase) {
    options.database = databaseName;
  }

  return options;
};

export const pool = mysql.createPool(createMysqlOptions());

export const closeDb = async (): Promise<void> => {
  await pool.end();
};
