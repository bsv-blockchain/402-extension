import type { PaymentHeaders, CachedPayment } from './types.js'

/**
 * Payment cache backed by chrome.storage.local.
 *
 * Stores payment headers keyed by URL so that repeat visits to the same
 * paid resource within the TTL reuse the existing payment headers without
 * constructing a new transaction. Persists across service worker restarts
 * and browser restarts.
 *
 * The server may or may not accept a replayed payment — if the retry with
 * cached headers gets a 402, the caller should evict the entry and
 * construct a fresh payment.
 */

const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const STORAGE_PREFIX = '402cache:'

function storageKey (url: string): string {
  return `${STORAGE_PREFIX}${url}`
}

/**
 * Look up cached payment headers for a URL.
 * Returns the headers if found and not expired, or null otherwise.
 */
export async function getCachedPayment (url: string): Promise<PaymentHeaders | null> {
  const key = storageKey(url)
  const result = await chrome.storage.local.get(key)
  const entry = result[key] as CachedPayment | undefined

  if (!entry) return null

  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    // Expired — remove it
    await chrome.storage.local.remove(key)
    return null
  }

  return entry.headers
}

/**
 * Store payment headers for a URL in the cache.
 */
export async function setCachedPayment (url: string, headers: PaymentHeaders): Promise<void> {
  const key = storageKey(url)
  const entry: CachedPayment = {
    headers,
    timestamp: Date.now()
  }
  await chrome.storage.local.set({ [key]: entry })
}

/**
 * Remove a cached payment for a URL.
 * Called when the server rejects a cached payment (returns 402 again).
 */
export async function evictCachedPayment (url: string): Promise<void> {
  await chrome.storage.local.remove(storageKey(url))
}

/**
 * Remove all expired entries from the cache.
 * Called periodically to prevent unbounded storage growth.
 */
export async function pruneExpiredEntries (): Promise<void> {
  const all = await chrome.storage.local.get(null)
  const now = Date.now()
  const keysToRemove: string[] = []

  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(STORAGE_PREFIX)) continue
    const entry = value as CachedPayment
    if (now - entry.timestamp > CACHE_TTL_MS) {
      keysToRemove.push(key)
    }
  }

  if (keysToRemove.length > 0) {
    await chrome.storage.local.remove(keysToRemove)
    console.log(`[402-ext] Pruned ${keysToRemove.length} expired cache entries`)
  }
}
