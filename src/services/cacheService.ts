export type CacheClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttlSeconds: number): Promise<unknown>;
};

const inFlight = new Map<string, Promise<unknown>>();

export const getWithStampedeProtection = async <T>(
  cache: CacheClient,
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> => {
  const cached = await cache.get(key);
  if (cached) {
    return JSON.parse(cached) as T;
  }

  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    try {
      const result = await fetcher();
      await cache.set(key, JSON.stringify(result), "EX", ttlSeconds);
      return result;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
};

export const clearInFlightCache = (): void => {
  inFlight.clear();
};
