import "dotenv/config";
import Redis from "ioredis";

const config = {
  apiUrl:
    process.env.ANALYTICS_API_URL ??
    "http://localhost:5000/v1/analytics/summary",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  cacheKey: process.env.ANALYTICS_CACHE_KEY ?? "analytics:summary",
  warmRequests: Number(process.env.WARM_REQUESTS ?? 20),
  stampedeConcurrency: Number(process.env.STAMPEDE_CONCURRENCY ?? 100),
  slowReadMinimumMs: Number(process.env.SLOW_READ_MINIMUM_MS ?? 1800),
  cachedTargetMs: Number(process.env.CACHED_TARGET_MS ?? 50),
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 10000),
};

const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null,
});

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const average = (values) => {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const percentile = (values, p) => {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  );
  return sorted[index];
};

const formatMs = (value) => `${value.toFixed(2)}ms`;

const passFail = (condition) => (condition ? "PASS" : "CHECK");

const clearAnalyticsCache = async () => {
  await redis.del(config.cacheKey);
};

const requestSummary = async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  const started = performance.now();

  try {
    const response = await fetch(config.apiUrl, {
      method: "GET",
      signal: controller.signal,
    });
    const latencyMs = performance.now() - started;
    let body = null;

    try {
      body = await response.json();
    } catch {
      body = null;
    }

    return {
      ok: response.ok,
      status: response.status,
      latencyMs,
      body,
      error: "",
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latencyMs: performance.now() - started,
      body: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
};

const validateSummaryShape = (body) => {
  const errors = [];

  if (!body || typeof body !== "object") {
    return ["Response body is not a JSON object"];
  }

  if (typeof body.generatedAt !== "string") {
    errors.push("generatedAt must be a string");
  }

  if (typeof body.totalTransactions !== "number") {
    errors.push("totalTransactions must be a number");
  }

  if (typeof body.totalVolume !== "number") {
    errors.push("totalVolume must be a number");
  }

  if (!Array.isArray(body.topUsers)) {
    errors.push("topUsers must be an array");
  } else {
    if (body.topUsers.length > 5) {
      errors.push("topUsers must contain at most 5 users");
    }

    for (let index = 1; index < body.topUsers.length; index += 1) {
      if (
        Number(body.topUsers[index - 1].totalVolume) <
        Number(body.topUsers[index].totalVolume)
      ) {
        errors.push("topUsers must be sorted by totalVolume descending");
        break;
      }
    }
  }

  if (!Array.isArray(body.volumeByCurrency)) {
    errors.push("volumeByCurrency must be an array");
  }

  return errors;
};

const printLatencyReport = (label, results) => {
  const successful = results.filter((result) => result.ok);
  const failed = results.filter((result) => !result.ok);
  const latencies = results.map((result) => result.latencyMs);

  console.log("");
  console.log(`=== ${label} ===`);
  console.log(`requests: ${results.length}`);
  console.log(`success/failed: ${successful.length}/${failed.length}`);
  console.log(
    `latency avg/p50/p95/p99/max: ${formatMs(average(latencies))}/${formatMs(
      percentile(latencies, 50),
    )}/${formatMs(percentile(latencies, 95))}/${formatMs(
      percentile(latencies, 99),
    )}/${formatMs(Math.max(0, ...latencies))}`,
  );

  const firstError = failed.find((result) => result.error || result.status);
  if (firstError) {
    console.log(
      `first failure: status=${firstError.status} error=${firstError.error}`,
    );
  }
};

const testColdRequest = async () => {
  await clearAnalyticsCache();

  console.log("");
  console.log("1. Cold cache test");
  console.log(`Cleared Redis key: ${config.cacheKey}`);
  console.log("Expected: one slow request around 2 seconds.");

  const result = await requestSummary();
  const shapeErrors = validateSummaryShape(result.body);

  console.log(`status: ${result.status}`);
  console.log(`latency: ${formatMs(result.latencyMs)}`);
  console.log(
    `${passFail(result.latencyMs >= config.slowReadMinimumMs)} slow read simulation`,
  );
  console.log(`${passFail(shapeErrors.length === 0)} response shape`);

  if (shapeErrors.length > 0) {
    console.log(`shape errors: ${shapeErrors.join(", ")}`);
  }

  return result;
};

const testWarmCache = async () => {
  console.log("");
  console.log("2. Warm cache speed test");
  console.log(
    `Expected: cached responses should target less than ${config.cachedTargetMs}ms.`,
  );

  const results = [];
  for (let index = 0; index < config.warmRequests; index += 1) {
    results.push(await requestSummary());
  }

  printLatencyReport("WARM CACHE RESULTS", results);

  const latencies = results.map((result) => result.latencyMs);
  const p95 = percentile(latencies, 95);
  console.log(`${passFail(p95 <= config.cachedTargetMs)} warm cache p95 target`);

  return results;
};

const testStampedeProtection = async () => {
  await clearAnalyticsCache();
  await sleep(100);

  console.log("");
  console.log("3. Cache stampede test");
  console.log(`Cleared Redis key: ${config.cacheKey}`);
  console.log(
    `Sending ${config.stampedeConcurrency} concurrent requests to an empty cache.`,
  );
  console.log(
    "Expected: all requests wait for the same in-flight analytics computation and complete around the same 2-second window.",
  );
  console.log(
    "In the API terminal, you should see only one analytics DB computation if you add/log that message in computeAnalyticsSummary.",
  );

  const started = performance.now();
  const results = await Promise.all(
    Array.from({ length: config.stampedeConcurrency }, () => requestSummary()),
  );
  const wallTimeMs = performance.now() - started;
  const latencies = results.map((result) => result.latencyMs);

  printLatencyReport("STAMPEDE RESULTS", results);
  console.log(`total wall time: ${formatMs(wallTimeMs)}`);
  console.log(
    `${passFail(
      wallTimeMs >= config.slowReadMinimumMs &&
        wallTimeMs < config.requestTimeoutMs,
    )} concurrent miss completed in one slow-read window`,
  );
  console.log(
    `${passFail(
      Math.max(0, ...latencies) - Math.min(...latencies) < 1000,
    )} concurrent requests completed close together`,
  );

  return results;
};

const main = async () => {
  console.log("Starting analytics summary API test");
  console.log(`API URL: ${config.apiUrl}`);
  console.log(`Redis URL: ${config.redisUrl}`);
  console.log(`Cache key: ${config.cacheKey}`);
  console.log("");
  console.log("Start the API first:");
  console.log("npm.cmd run dev");

  await testColdRequest();
  await testWarmCache();
  await testStampedeProtection();

  console.log("");
  console.log("Done.");
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await redis.quit();
  });
