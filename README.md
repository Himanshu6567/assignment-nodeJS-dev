# transaction ingestion backend

This project implements a transaction ingestion backend with:

- `POST /v1/transactions` for fast transaction acceptance.
- A BullMQ background worker for reliable processing and retries.
- MySQL persistence with DB-level idempotency.
- `GET /v1/analytics/summary` with Redis caching and cache stampede protection.

## Tech Stack

- Node.js + TypeScript
- Express
- BullMQ + Redis
- MySQL
- Zod validation
- Vitest

## Project Structure

```text
src/
  config/              Environment configuration
  db/                  MySQL pool, migrations, seed script
  middleware/          Rate limiter and error handler
  queue/               BullMQ queue and worker
  routes/              API routes
  services/            Transaction, analytics, and cache logic
  types/               Request/response schemas
test/                  Unit tests
TestingAPI/            Local API load and behavior test scripts
docker-compose.yml     Local MySQL and Redis
```

## Setup

1. Install dependencies:

```bash
npm install
```

2. Start MySQL and Redis:

```bash
docker compose up -d
```

If `docker` is not available, install Docker Desktop or run MySQL and Redis locally with values matching `.env`.

3. Copy environment values if needed:

```bash
cp .env.example .env
```

PowerShell:

```powershell
Copy-Item .env.example .env
```

4. Run database migration and seed wallets:

```bash
npm run migrate
npm run seed
```

5. Start the API server:

```bash
npm run dev
```

6. In a second terminal, start the worker:

```bash
npm run worker
```

The API runs on `http://localhost:5000` by default.

## API Usage

Health check:

```bash
curl http://localhost:5000/health
```

Create a transaction:

```bash
curl -X POST http://localhost:5000/v1/transactions \
  -H "Content-Type: application/json" \
  -d '{
    "id": "txn-1001",
    "userId": "user-1",
    "amount": 25.5,
    "currency": "USD",
    "timestamp": "2026-07-03T10:00:00.000Z"
  }'
```

Expected response:

```json
{
  "accepted": true,
  "transactionId": "txn-1001"
}
```

`accepted: true` means the API validated the payload and queued it. The row is inserted by the worker process, so `npm run worker` must be running in another terminal.

If the same transaction id is submitted again while BullMQ still knows about the job, the API returns a duplicate response instead of queuing it twice:

```json
{
  "accepted": false,
  "duplicate": true,
  "transactionId": "txn-1001",
  "queueState": "completed",
  "message": "Transaction id was already submitted."
}
```

Get analytics:

```bash
curl http://localhost:5000/v1/analytics/summary
```

The first analytics request intentionally takes about 2 seconds because the service simulates a slow DB query. Later requests are served from Redis and should be much faster until the cache expires.

## How Reliability Works

The ingestion endpoint validates the request and adds a BullMQ job using the transaction `id` as `jobId`. That prevents duplicate waiting jobs in Redis and lets the API return `202 Accepted` quickly without doing database work in the request path.

The worker is also idempotent at the database level. It inserts the transaction id into `processed_transactions` inside the same MySQL transaction as the wallet update and transaction insert. If that insert is ignored because the id already exists, the worker treats the job as already processed and exits safely. This is important because a retry can happen after partial progress or after the API receives the same transaction more than once.

BullMQ retries failed jobs up to 3 times with exponential backoff.

## Cache Stampede Protection

`GET /v1/analytics/summary` uses Redis for the cached analytics result. On a cache miss, the first request starts the slow analytics query and stores its Promise in an in-process `Map`. Concurrent requests for the same cache key await that same Promise instead of starting more DB queries. When the query finishes, the result is saved to Redis with a TTL and the in-flight entry is removed.

For multiple API instances in production, replace the in-process single-flight map with a Redis lock using `SET lock-key value NX PX 5000`. The instance that gets the lock computes and populates the cache; other instances wait briefly and read the cached value.

## Testing

Run unit tests:

```bash
npm test
```

Run TypeScript checks:

```bash
npm run typecheck
```

Run transaction API load test:

```bash
npm run test:transaction-api
```

Run analytics cache/stampede test:

```bash
npm run test:analytics-api
```

Manual end-to-end test:

1. `docker compose up -d`
2. `npm run migrate`
3. `npm run seed`
4. Terminal 1: `npm run dev`
5. Terminal 2: `npm run worker`
6. Send the transaction `curl` request above.
7. Send it again with the same `id`. It should still return `202`, and the worker should log `duplicate` instead of deducting twice.
8. Call `GET /v1/analytics/summary` twice. The first call is slow; the second call should be fast.

## Useful Commands

```bash
npm run dev        # start API in watch mode
npm run worker     # start BullMQ worker
npm run migrate    # recreate database and create tables
npm run seed       # create sample wallets
npm test           # run unit tests
npm run typecheck  # check TypeScript
```

## Load Testing Note

The transaction endpoint includes rate limiting by default:

```env
RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=120
```

For a real high-volume local benchmark, raise the limit or disable it before starting the API:

```powershell
$env:RATE_LIMIT_ENABLED="false"
npm.cmd run dev
```

or:

```powershell
$env:RATE_LIMIT_MAX="100000"
npm.cmd run dev
```

Then run:

```powershell
node TestingAPI\transaction-api-load-test.mjs
```

The transaction load script reports:

- client-side created, sent, and completed requests
- accepted, duplicate, validation failed, rate-limited, server failed, and network failed counts
- BullMQ waiting, active, completed, failed, delayed, and paused counts
- MySQL rows stored for the current test run
- average, p50, p95, p99, and max client latency

Useful options:

```powershell
$env:TOTAL_REQUESTS="50000"
$env:CONCURRENCY="200"
$env:INVALID_EVERY="100"
$env:DUPLICATE_EVERY="50"
npm.cmd run test:transaction-api
```

## Analytics Testing

The analytics script verifies the assessment requirements for `GET /v1/analytics/summary`:

- cold cache request takes about 2 seconds
- warm cache requests target less than 50ms
- 100 concurrent cache-miss requests wait on one in-flight DB computation
- response includes total volume and top 5 users sorted by volume

Run the API first:

```powershell
npm.cmd run dev
```

Then run:

```powershell
npm.cmd run test:analytics-api
```

Useful options:

```powershell
$env:STAMPEDE_CONCURRENCY="100"
$env:WARM_REQUESTS="20"
npm.cmd run test:analytics-api
```

During the stampede test, the API terminal should print this once after the Redis cache is cleared:

```text
Analytics cache miss: computing summary from database
```
