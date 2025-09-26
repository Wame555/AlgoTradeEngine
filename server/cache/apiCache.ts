interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

export const MICRO_CACHE_TTL_MS = 1500;
export const DEFAULT_CACHE_TTL_MS = MICRO_CACHE_TTL_MS;

export async function cached<T>(
  key: string,
  ttlMs: number = DEFAULT_CACHE_TTL_MS,
  fetcher: () => Promise<T>,
): Promise<{ value: T; cacheHit: boolean }> {
  const now = Date.now();
  const existing = store.get(key);

  if (existing && existing.expiresAt > now) {
    return { value: existing.value as T, cacheHit: true };
  }

  const value = await fetcher();
  const ttl = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_CACHE_TTL_MS;
  store.set(key, { value, expiresAt: now + ttl });

  return { value, cacheHit: false };
}

export function clearCacheKey(key: string): void {
  store.delete(key);
}

export function clearCache(): void {
  store.clear();
}
