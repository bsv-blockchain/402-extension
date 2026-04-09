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
  /** Timestamp when this payment started processing */
  timestamp: number
}
