import "dotenv/config";
import { Queue } from "bullmq";
import mysql from "mysql2/promise";

const config = {
  apiUrl: process.env.TRANSACTION_API_URL ?? "http://localhost:5000/v1/transactions",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  databaseUrl:
    process.env.DATABASE_URL ?? "mysql://root:mysql@localhost:3306/transactions_db",
  totalRequests: Number(process.env.TOTAL_REQUESTS ?? 50000),
  concurrency: Number(process.env.CONCURRENCY ?? 200),
  reportEveryMs: Number(process.env.REPORT_EVERY_MS ?? 2000),
  timeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 10000),
  invalidEvery: Number(process.env.INVALID_EVERY ?? 100),
  duplicateEvery: Number(process.env.DUPLICATE_EVERY ?? 50),
  waitForDrain: (process.env.WAIT_FOR_DRAIN ?? "true").toLowerCase() !== "false",
  drainTimeoutMs: Number(process.env.DRAIN_TIMEOUT_MS ?? 600000),
};

const runId = `load-${Date.now()}`;
const startedAt = Date.now();

const stats = {
  planned: config.totalRequests,
  created: 0,
  sent: 0,
  completed: 0,
  accepted: 0,
  duplicate: 0,
  validationRejected: 0,
  rateLimited: 0,
  serverErrors: 0,
  networkErrors: 0,
  otherResponses: 0,
  failed: 0,
  validPayloads: 0,
  invalidPayloads: 0,
  duplicatePayloads: 0,
  clientLatencyMs: [],
  lastError: "",
  lastDbError: "",
};

const queue = new Queue("transactions", {
  connection: {
    url: config.redisUrl,
    maxRetriesPerRequest: null,
  },
});

const createMysqlOptions = () => {
  const url = new URL(config.databaseUrl);

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace("/", "")),
    waitForConnections: true,
    connectionLimit: 5,
    decimalNumbers: true,
  };
};

const db = mysql.createPool(createMysqlOptions());

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const percentile = (values, p) => {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
};

const average = (values) => {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const makeValidPayload = (index) => ({
  id: `${runId}-txn-${index}`,
  userId: `user-${(index % 5) + 1}`,
  amount: Number(((index % 100) + 1).toFixed(2)),
  currency: ["USD", "INR", "EUR", "GBP", "JPY"][index % 5],
  timestamp: new Date().toISOString(),
});

const invalidCases = [
  (index) => ({ ...makeValidPayload(index), id: "" }),
  (index) => ({ ...makeValidPayload(index), userId: "" }),
  (index) => ({ ...makeValidPayload(index), amount: 0 }),
  (index) => ({ ...makeValidPayload(index), amount: -10 }),
  (index) => ({ ...makeValidPayload(index), amount: "10" }),
  (index) => ({ ...makeValidPayload(index), currency: "US" }),
  (index) => ({ ...makeValidPayload(index), currency: "USDD" }),
  (index) => ({ ...makeValidPayload(index), timestamp: "not-a-date" }),
  (index) => {
    const payload = makeValidPayload(index);
    delete payload.timestamp;
    return payload;
  },
];

const makePayload = (index) => {
  if (config.invalidEvery > 0 && index % config.invalidEvery === 0) {
    stats.invalidPayloads += 1;
    return invalidCases[(index / config.invalidEvery) % invalidCases.length](index);
  }

  if (config.duplicateEvery > 0 && index % config.duplicateEvery === 0) {
    stats.duplicatePayloads += 1;
    return {
      ...makeValidPayload(index),
      id: `${runId}-duplicate-${Math.floor(index / config.duplicateEvery) % 25}`,
    };
  }

  stats.validPayloads += 1;
  return makeValidPayload(index);
};

const classifyResponse = async (response) => {
  let body = {};

  try {
    body = await response.json();
  } catch {
    body = {};
  }

  if (response.status === 202 && body.accepted === true) {
    stats.accepted += 1;
    return;
  }

  if (response.status === 200 && body.duplicate === true) {
    stats.duplicate += 1;
    return;
  }

  if (response.status === 400) {
    stats.validationRejected += 1;
    return;
  }

  if (response.status === 429) {
    stats.rateLimited += 1;
    return;
  }

  if (response.status >= 500) {
    stats.serverErrors += 1;
    stats.failed += 1;
    stats.lastError = JSON.stringify(body);
    return;
  }

  stats.otherResponses += 1;
  stats.lastError = `Unexpected status ${response.status}: ${JSON.stringify(body)}`;
};

const sendOne = async (index) => {
  const payload = makePayload(index);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const started = performance.now();

  stats.sent += 1;

  try {
    const response = await fetch(config.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    stats.clientLatencyMs.push(performance.now() - started);
    await classifyResponse(response);
  } catch (error) {
    stats.networkErrors += 1;
    stats.failed += 1;
    stats.lastError = error instanceof Error ? error.message : String(error);
  } finally {
    clearTimeout(timeout);
    stats.completed += 1;
  }
};

const getDbStoredCount = async () => {
  try {
    const [rows] = await db.query(
      "SELECT COUNT(*) AS stored_count FROM transactions WHERE id LIKE ?",
      [`${runId}-%`],
    );

    stats.lastDbError = "";
    return Number(rows[0]?.stored_count ?? 0);
  } catch (error) {
    stats.lastDbError = error instanceof Error ? error.message : String(error);
    return -1;
  }
};

const getQueueCounts = async () =>
  queue.getJobCounts(
    "waiting",
    "active",
    "completed",
    "failed",
    "delayed",
    "paused",
  );

const printReport = async (final = false) => {
  const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
  const queueCounts = await getQueueCounts();
  const dbStored = await getDbStoredCount();
  const latencies = stats.clientLatencyMs;

  console.log("");
  console.log(final ? "=== FINAL TRANSACTION API LOAD TEST ===" : "=== TRANSACTION API LOAD TEST ===");
  console.log(`runId: ${runId}`);
  console.log(`client created/sent/completed: ${stats.created}/${stats.sent}/${stats.completed}`);
  console.log(
    `client result accepted/duplicate/validation/429/server/network/other: ${stats.accepted}/${stats.duplicate}/${stats.validationRejected}/${stats.rateLimited}/${stats.serverErrors}/${stats.networkErrors}/${stats.otherResponses}`,
  );
  console.log(
    `payload mix valid/duplicate/invalid: ${stats.validPayloads}/${stats.duplicatePayloads}/${stats.invalidPayloads}`,
  );
  console.log(
    `queue waiting/active/completed/failed/delayed/paused: ${queueCounts.waiting}/${queueCounts.active}/${queueCounts.completed}/${queueCounts.failed}/${queueCounts.delayed}/${queueCounts.paused}`,
  );
  console.log(`mysql stored rows for this run: ${dbStored === -1 ? "not available" : dbStored}`);
  console.log(
    `client throughput: ${(stats.completed / elapsedSeconds).toFixed(2)} responses/sec`,
  );
  console.log(
    `client latency ms avg/p50/p95/p99/max: ${average(latencies).toFixed(2)}/${percentile(latencies, 50).toFixed(2)}/${percentile(latencies, 95).toFixed(2)}/${percentile(latencies, 99).toFixed(2)}/${Math.max(0, ...latencies).toFixed(2)}`,
  );

  if (stats.lastError) {
    console.log(`last error: ${stats.lastError}`);
  }

  if (stats.lastDbError) {
    console.log(`mysql progress error: ${stats.lastDbError}`);
  }
};

const runWorkers = async () => {
  let nextIndex = 1;

  const worker = async () => {
    while (nextIndex <= config.totalRequests) {
      const index = nextIndex;
      nextIndex += 1;
      stats.created += 1;
      await sendOne(index);
    }
  };

  await Promise.all(
    Array.from({ length: config.concurrency }, () => worker()),
  );
};

const waitForQueueDrain = async () => {
  if (!config.waitForDrain) return;

  console.log("");
  console.log("Client finished sending requests. Waiting for worker/queue to drain...");

  const drainStartedAt = Date.now();

  while (Date.now() - drainStartedAt < config.drainTimeoutMs) {
    const counts = await getQueueCounts();
    const pending = counts.waiting + counts.active + counts.delayed + counts.paused;

    if (pending === 0) {
      return;
    }

    await sleep(config.reportEveryMs);
  }

  stats.lastError = `Queue did not drain within ${config.drainTimeoutMs}ms`;
};

const main = async () => {
  console.log("Starting transaction API load test");
  console.log(`API URL: ${config.apiUrl}`);
  console.log(`Total requests: ${config.totalRequests}`);
  console.log(`Concurrency: ${config.concurrency}`);
  console.log(`Run id: ${runId}`);
  console.log("");
  console.log("Important:");
  console.log("- Start API first: npm.cmd run dev");
  console.log("- Start worker in another terminal: npm.cmd run worker");
  console.log("- For true 50K ingestion, set RATE_LIMIT_MAX high or RATE_LIMIT_ENABLED=false before starting the API.");
  console.log("- If you keep the default limiter, most fast requests will correctly return 429.");

  const reporter = setInterval(() => {
    void printReport(false);
  }, config.reportEveryMs);

  try {
    await runWorkers();
    await waitForQueueDrain();
    await printReport(true);
  } finally {
    clearInterval(reporter);
    await queue.close();
    await db.end();
  }
};

main().catch(async (error) => {
  console.error(error);
  await queue.close();
  await db.end();
  process.exitCode = 1;
});
