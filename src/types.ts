/**
 * Tracks an in-flight 402 payment being processed for a specific tab.
 * Used to prevent re-entrant handling (infinite loops) and to manage
 * DNR rule cleanup after the retry completes.
 */
export interface PendingPayment {
  /** The tab where the 402 was encountered */
  tabId: number
  /** The URL that returned 402 */
  url: string
  /** Satoshis required (from x-bsv-sats header) */
  sats: number
  /** Server identity key (from x-bsv-server header) */
  serverKey: string
  /** DNR session rule ID, set after payment headers are installed */
  ruleId: number | null
  /** Whether the payment headers came from the cache */
  fromCache: boolean
  /** Timestamp when this payment started processing */
  timestamp: number
}

/**
 * The set of BRC-0121 payment headers sent on the retry request.
 */
export interface PaymentHeaders {
  'x-bsv-sender': string
  'x-bsv-beef': string
  'x-bsv-prefix': string
  'x-bsv-suffix': string
  'x-bsv-vout': string
}

/**
 * A cached payment entry stored in chrome.storage.local.
 * Keyed by URL, allows reuse of payment headers on repeat
 * requests to the same resource without re-paying.
 */
export interface CachedPayment {
  headers: PaymentHeaders
  timestamp: number
}
