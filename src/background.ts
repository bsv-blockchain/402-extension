import { constructPayment } from './payment-handler.js'
import type { PaymentHeaders } from '@bsv/402-pay/client'
import type { PendingPayment } from './types.js'
import { HEADERS } from '@bsv/402-pay'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * In-flight payments keyed by tabId.
 * Prevents re-entrant handling: if a tab already has a pending payment,
 * subsequent 402 responses on that tab are ignored (prevents infinite loops
 * when the retry itself returns 402).
 */
const pendingPayments = new Map<number, PendingPayment>()

/**
 * Counter for generating unique DNR session rule IDs.
 * Chrome requires integer IDs >= 1 for declarativeNetRequest rules.
 */
let nextRuleId = 1

// ---------------------------------------------------------------------------
// DNR rule management
// ---------------------------------------------------------------------------

/**
 * Install a declarativeNetRequest session rule that attaches the BRC-0121
 * payment headers to the next request matching the given URL and tab.
 *
 * Session rules persist only for the browser session and are automatically
 * cleaned up when the extension is unloaded or the browser closes.
 */
async function addPaymentHeaderRules (
  tabId: number,
  url: string,
  headers: PaymentHeaders
): Promise<number> {
  const ruleId = nextRuleId++

  const requestHeaders = Object.entries(headers).map(([header, value]) => ({
    header,
    operation: chrome.declarativeNetRequest.HeaderOperation.SET,
    value
  }))

  await chrome.declarativeNetRequest.updateSessionRules({
    addRules: [{
      id: ruleId,
      priority: 1,
      action: {
        type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
        requestHeaders
      },
      condition: {
        urlFilter: url,
        tabIds: [tabId],
        resourceTypes: [
          chrome.declarativeNetRequest.ResourceType.MAIN_FRAME,
          chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
          chrome.declarativeNetRequest.ResourceType.OTHER
        ]
      }
    }]
  })

  return ruleId
}

/**
 * Remove a previously installed session rule by ID.
 */
async function removeRule (ruleId: number): Promise<void> {
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ruleId]
    })
  } catch {
    // Rule may already have been removed; ignore
  }
}

// ---------------------------------------------------------------------------
// Payment orchestration
// ---------------------------------------------------------------------------

/**
 * Handle a detected 402 response:
 * 1. Construct payment via the BSV wallet (auto-discovered substrate)
 * 2. Install DNR rules to attach payment headers
 * 3. Retry the navigation via chrome.tabs.update
 */
async function handlePayment (
  tabId: number,
  url: string,
  sats: number,
  serverKey: string
): Promise<void> {
  console.log(`[402-ext] Handling payment: ${sats} sats for ${url}`)

  try {
    // Construct payment transaction via the wallet
    const paymentHeaders = await constructPayment(url, sats, serverKey)

    // Check if this payment was cancelled while we were waiting for the wallet
    if (!pendingPayments.has(tabId)) {
      console.log(`[402-ext] Payment cancelled for tab ${tabId}`)
      return
    }

    // Install DNR rules so the retry request carries the payment headers
    const ruleId = await addPaymentHeaderRules(tabId, url, paymentHeaders)

    // Update pending payment state with the rule ID
    const pending = pendingPayments.get(tabId)!
    pending.ruleId = ruleId

    console.log(`[402-ext] Payment headers installed (rule ${ruleId}), retrying ${url}`)

    // Trigger the retry by navigating the tab to the same URL
    await chrome.tabs.update(tabId, { url })
  } catch (err) {
    console.error(`[402-ext] Payment failed for ${url}:`, err)
    // Clean up pending state so the user can try again
    pendingPayments.delete(tabId)
  }
}

/**
 * Clean up after a retry completes (successfully or not).
 * Removes the DNR session rule and clears the pending payment state.
 */
function cleanupPayment (tabId: number): void {
  const pending = pendingPayments.get(tabId)
  if (!pending) return

  if (pending.ruleId !== null) {
    removeRule(pending.ruleId)
  }
  pendingPayments.delete(tabId)
  console.log(`[402-ext] Cleaned up payment state for tab ${tabId}`)
}

// ---------------------------------------------------------------------------
// webRequest listeners (registered at top level for service worker survival)
// ---------------------------------------------------------------------------

/**
 * Observe response headers on all HTTP responses.
 * When a 402 is detected with the required x-bsv-* headers,
 * initiate the payment flow.
 */
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    // Only handle main_frame navigations and XHR/fetch requests
    if (details.type !== 'main_frame' &&
        details.type !== 'xmlhttprequest' &&
        details.type !== 'other') {
      return
    }

    if (details.statusCode !== 402) return

    // Prevent re-entrant handling: if this tab already has a pending payment,
    // the retry itself got a 402 (payment rejected). Don't loop.
    if (pendingPayments.has(details.tabId)) {
      console.warn(
        `[402-ext] Tab ${details.tabId} already has a pending payment; ` +
        `retry returned 402. Not retrying again.`
      )
      cleanupPayment(details.tabId)
      return
    }

    // Extract BRC-0121 headers from the 402 response
    const responseHeaders = details.responseHeaders || []
    let satsValue: string | undefined
    let serverValue: string | undefined

    for (const header of responseHeaders) {
      const name = header.name.toLowerCase()
      if (name === HEADERS.SATS) {
        satsValue = header.value
      } else if (name === HEADERS.SERVER) {
        serverValue = header.value
      }
    }

    if (!satsValue || !serverValue) {
      // Not a BRC-0121 server, or headers not exposed. Nothing to do.
      return
    }

    const sats = Number.parseInt(satsValue, 10)
    if (Number.isNaN(sats) || sats <= 0) {
      console.warn(`[402-ext] Invalid x-bsv-sats value: ${satsValue}`)
      return
    }

    // Mark this tab as having a pending payment
    pendingPayments.set(details.tabId, {
      tabId: details.tabId,
      url: details.url,
      sats,
      serverKey: serverValue,
      ruleId: null,
      timestamp: Date.now()
    })

    // Fire-and-forget: handle the payment asynchronously.
    // The webRequest listener must return synchronously.
    handlePayment(details.tabId, details.url, sats, serverValue)
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders', 'extraHeaders']
)

/**
 * When a request completes on a tab with a pending payment,
 * clean up the DNR rules and pending state.
 *
 * This fires for the retry request after the payment headers
 * have been applied. Whether the server returns 200 or an error,
 * we clean up. (A second 402 is caught in onHeadersReceived above.)
 */
chrome.webRequest.onCompleted.addListener(
  (details) => {
    const pending = pendingPayments.get(details.tabId)
    if (!pending?.ruleId) return

    // Only clean up if this completion is for the URL we're paying for
    if (details.url === pending.url) {
      cleanupPayment(details.tabId)
    }
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
)

/**
 * Also clean up if the retry request fails at the network level.
 */
chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    const pending = pendingPayments.get(details.tabId)
    if (!pending) return

    if (details.url === pending.url) {
      console.warn(`[402-ext] Request error for ${details.url}: ${details.error}`)
      cleanupPayment(details.tabId)
    }
  },
  { urls: ['<all_urls>'] }
)

// ---------------------------------------------------------------------------
// Tab lifecycle cleanup
// ---------------------------------------------------------------------------

/**
 * Clean up pending payment state when a tab is closed.
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  cleanupPayment(tabId)
})

/**
 * Clean up if the user navigates away from the pending payment URL.
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  const pending = pendingPayments.get(tabId)
  if (!pending) return

  // If the tab navigates to a different URL, cancel the pending payment
  if (changeInfo.url && changeInfo.url !== pending.url) {
    console.log(`[402-ext] Tab ${tabId} navigated away, cancelling payment`)
    cleanupPayment(tabId)
  }
})

// ---------------------------------------------------------------------------
// Periodic stale payment cleanup
// ---------------------------------------------------------------------------

/**
 * Clean up payments that have been pending for too long (e.g., wallet
 * never responded, user never approved the spending request).
 * Runs every 60 seconds.
 */
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
console.log('[402-ext] BSV 402 Payments extension loaded')
