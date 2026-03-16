import { LRUCache } from 'lru-cache';
import type { ProjectedMapCache } from 'projected';

export function createLruCache<TKey, TValue>(options: {
  max: number;
  ttl: number | undefined;
  onEvict: ((value: TValue, key: TKey) => void) | undefined;
}): ProjectedMapCache<TKey, TValue> {
  const { max, ttl, onEvict: dispose } = options;

  const lru = new LRUCache<any, any>({
    max,
    ...(ttl !== undefined && { ttl, ttlAutopurge: false }),
    ...(dispose !== undefined && { dispose }),
  });

  return {
    has: (key) => lru.has(key),
    get: (key) => lru.get(key),
    set: (key, value) => {
      lru.set(key, value);
    },
    delete: (key) => {
      lru.delete(key);
    },
    clear: () => {
      lru.clear();
    },
  };
}
