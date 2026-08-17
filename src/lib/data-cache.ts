type CacheEntry = {
  expiresAt: number
  value: Promise<unknown>
}

const MAX_ENTRIES = 100
const entries = new Map<string, CacheEntry>()

function evictExpired(now: number) {
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(key)
  }
}

function enforceLimit() {
  while (entries.size >= MAX_ENTRIES) {
    const oldest = entries.keys().next().value
    if (oldest === undefined) return
    entries.delete(oldest)
  }
}

/** Bounded in-process cache that also coalesces concurrent reads for the same key. */
export function cacheData<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const cached = entries.get(key)

  if (cached && cached.expiresAt > now) {
    entries.delete(key)
    entries.set(key, cached)
    return cached.value as Promise<T>
  }

  evictExpired(now)
  enforceLimit()

  const value = loader()
  const entry = { expiresAt: now + ttlMs, value }
  entries.set(key, entry)

  void value.catch(() => {
    if (entries.get(key) === entry) entries.delete(key)
  })

  return value
}

export function clearDataCache() {
  entries.clear()
}
