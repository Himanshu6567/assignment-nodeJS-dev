import "dotenv/config";

const numberFromEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a valid number`);
  }

  return parsed;
};

const booleanFromEnv = (name: string, fallback: boolean): boolean => {
  const raw = process.env[name];
  if (!raw) return fallback;

  return !["false", "0", "no", "off"].includes(raw.toLowerCase());
};

export const env = {
  port: numberFromEnv("PORT", 5000),
  databaseUrl:
    process.env.DATABASE_URL ??
    "mysql://root:mysql@localhost:3306/transactions_db",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  analyticsCacheTtlSeconds: numberFromEnv("ANALYTICS_CACHE_TTL_SECONDS", 30),
  defaultWalletBalance: numberFromEnv("DEFAULT_WALLET_BALANCE", 10000),
  rateLimitEnabled: booleanFromEnv("RATE_LIMIT_ENABLED", true),
  rateLimitWindowMs: numberFromEnv("RATE_LIMIT_WINDOW_MS", 60 * 1000),
  rateLimitMax: numberFromEnv("RATE_LIMIT_MAX", 120),
};
