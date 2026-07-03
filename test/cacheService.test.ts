import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearInFlightCache,
  getWithStampedeProtection,
  type CacheClient,
} from "../src/services/cacheService.ts";

class MemoryCache implements CacheClient {
  private readonly store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(
    key: string,
    value: string,
    _mode: "EX",
    _ttlSeconds: number,
  ): Promise<unknown> {
    this.store.set(key, value);
    return "OK";
  }
}

describe("getWithStampedeProtection", () => {
  afterEach(() => {
    clearInFlightCache();
  });

  it("runs the fetcher once for concurrent cache misses", async () => {
    const cache = new MemoryCache();
    const fetcher = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { totalTransactions: 10 };
    });

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        getWithStampedeProtection(cache, "analytics:summary", 30, fetcher),
      ),
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(results).toEqual(
      Array.from({ length: 10 }, () => ({ totalTransactions: 10 })),
    );
  });

  it("returns cached values after warm-up", async () => {
    const cache = new MemoryCache();
    const fetcher = vi.fn(async () => ({ totalTransactions: 4 }));

    await getWithStampedeProtection(cache, "analytics:summary", 30, fetcher);
    const cached = await getWithStampedeProtection(
      cache,
      "analytics:summary",
      30,
      fetcher,
    );

    expect(cached).toEqual({ totalTransactions: 4 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
