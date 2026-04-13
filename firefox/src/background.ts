import { constructPayment } from './payment-handler.js'
import type { PendingPayment } from './types.js'
import { HEADERS } from '@bsv/402-pay'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * Tabs with a detected 402 waiting for payment injection.
 *
 * Firefox approach:
 *   1. onHeadersReceived detects a 402, stores payment params, then calls
 *      browser.tabs.update to trigger a fresh navigation to the same URL.
 *   2. onBeforeSendHeaders intercepts that fresh navigation. Because we drove
 *      the retry ourselves via tabs.update, this request has a brand-new
 *      requestId that is guaranteed different from the 402'd one. We return
 *      a Promise that constructs the payment and injects headers before the
 *      request leaves the browser.
 *
 * This avoids the requestId collision that occurs when Firefox internally
 * re-fires onBeforeSendHeaders on the same requestId after a 402 error page.
 *
 * Re-entrancy guard: if a tab already has a pending payment when another 402
 * arrives, the server rejected our payment — we stop.
 */
const pendingPayments = new Map<number, PendingPayment>()

// ---------------------------------------------------------------------------
// Cleanup helpers
// ---------------------------------------------------------------------------

function cleanupPayment (tabId: number): void {
  if (!pendingPayments.has(tabId)) return
  pendingPayments.delete(tabId)
  console.log(`[402-ext] Cleaned up payment state for tab ${tabId}`)
}

// ---------------------------------------------------------------------------
// webRequest: detect 402 responses and trigger retry
// ---------------------------------------------------------------------------

/**
 * Watch all HTTP responses. When a 402 with BRC-0121 headers is detected,
 * store the payment parameters and immediately trigger a fresh navigation
 * to the same URL so onBeforeSendHeaders can inject payment headers into it.
 *
 * Firefox exposes all response headers by default — no 'extraHeaders' needed.
 */
browser.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.type !== 'main_frame' &&
        details.type !== 'xmlhttprequest' &&
        details.type !== 'other') {
      return
    }

    if (details.statusCode !== 402) return

    // Re-entrancy guard: a second 402 means payment was rejected. Stop.
    if (pendingPayments.has(details.tabId)) {
      console.warn(
        `[402-ext] Tab ${details.tabId}: server returned 402 again ` +
        `(payment rejected). Stopping.`
      )
      cleanupPayment(details.tabId)
      return
    }

    // Extract BRC-0121 payment headers from the 402 response
    const responseHeaders = details.responseHeaders || []
    let satsValue: string | undefined
    let serverValue: string | undefined

    for (const header of responseHeaders) {
      const name = header.name.toLowerCase()
      if (name === HEADERS.SATS) satsValue = header.value
      else if (name === HEADERS.SERVER) serverValue = header.value
    }

    if (!satsValue || !serverValue) return

    const sats = Number.parseInt(satsValue, 10)
    if (Number.isNaN(sats) || sats <= 0) {
      console.warn(`[402-ext] Invalid x-bsv-sats value: ${satsValue}`)
      return
    }

    console.log(`[402-ext] 402 detected: ${sats} sats for ${details.url}`)

    pendingPayments.set(details.tabId, {
      tabId: details.tabId,
      url: details.url,
      sats,
      serverKey: serverValue,
      ruleId: null,
      timestamp: Date.now(),
      requestId: details.requestId
    })

    // Drive the retry ourselves so onBeforeSendHeaders sees a fresh requestId.
    // We use setTimeout to let the current webRequest event cycle finish first.
    setTimeout(() => {
      browser.tabs.update(details.tabId, { url: details.url }).catch((err) => {
        console.error(`[402-ext] Failed to trigger retry navigation:`, err)
        cleanupPayment(details.tabId)
      })
    }, 0)
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
)

// ---------------------------------------------------------------------------
// webRequest: inject payment headers into the retry
// ---------------------------------------------------------------------------

/**
 * Intercept outgoing requests for tabs that have a pending payment.
 *
 * We only inject if this request is NOT the one that originally got the 402
 * (identified by requestId). The retry triggered by tabs.update above will
 * always have a fresh requestId, so it gets the payment headers injected.
 *
 * Returning a Promise from a blocking listener holds the request open while
 * we talk to the wallet asynchronously.
 *
 * Requires 'webRequestBlocking' permission in manifest.json.
 */
browser.webRequest.onBeforeSendHeaders.addListener(
  (details): Promise<browser.webRequest.BlockingResponse> | undefined => {
    const pending = pendingPayments.get(details.tabId)

    if (!pending || details.url !== pending.url) return undefined

    // Skip the original 402'd request — only inject into the retry
    if (details.requestId === pending.requestId) return undefined

    console.log(`[402-ext] Injecting payment headers for ${details.url}`)

    // Consume the pending entry immediately — re-entrancy safe
    pendingPayments.delete(details.tabId)

    return constructPayment(pending.url, pending.sats, pending.serverKey)
      .then((paymentHeaders) => {
        const existingHeaders = details.requestHeaders || []
        const newHeaders: browser.webRequest.HttpHeaders = [
          ...existingHeaders,
          ...Object.entries(paymentHeaders).map(([name, value]) => ({ name, value }))
        ]
        console.log(`[402-ext] Payment headers injected, sending request`)
        return { requestHeaders: newHeaders }
      })
      .catch((err) => {
        console.error(`[402-ext] Payment construction failed for ${pending.url}:`, err)
        return {}
      })
  },
  { urls: ['<all_urls>'] },
  ['blocking', 'requestHeaders']
)

// ---------------------------------------------------------------------------
// Tab lifecycle cleanup
// ---------------------------------------------------------------------------

browser.tabs.onRemoved.addListener((tabId) => {
  cleanupPayment(tabId)
})

// ---------------------------------------------------------------------------
// Periodic stale payment cleanup
// ---------------------------------------------------------------------------

const STALE_PAYMENT_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

setInterval(() => {
  const now = Date.now()
  for (const [tabId, pending] of pendingPayments) {
    if (now - pending.timestamp > STALE_PAYMENT_TIMEOUT_MS) {
      console.warn(`[402-ext] Stale payment for tab ${tabId}, cleaning up`)
      cleanupPayment(tabId)
    }
  }
}, 60_000)

// ---------------------------------------------------------------------------
console.log('[402-ext] BSV 402 Payments Firefox extension loaded')
