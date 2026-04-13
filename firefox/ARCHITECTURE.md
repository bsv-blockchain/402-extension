# Firefox Extension Architecture

## Overview

This extension automatically handles HTTP 402 Payment Required responses by
constructing a BRC-0121 payment and retrying the request with the appropriate
payment headers attached.

## Why Firefox needs a different approach from Chrome

The Chrome extension uses `declarativeNetRequest` (DNR) session rules to inject
headers, combined with `chrome.tabs.update` to trigger a retry navigation. DNR
is a declarative, stateless API that Chrome designed specifically for MV3.

Firefox presented two blockers to this approach:

1. **`declarativeNetRequest` `modifyHeaders` is unreliable in Firefox** for
   dynamically-installed session rules on navigations. Using it produced
   `NS_ERROR_NET_EMPTY_RESPONSE` — the request was cancelled at the network
   level rather than having its headers modified.

2. **Firefox does not support `service_worker` in background scripts** (as of
   Firefox 128). The background context must be declared as `scripts` in
   `manifest.json`, which gives a persistent background page rather than an
   ephemeral service worker.

Firefox does however support something Chrome MV3 does not: **async blocking
`webRequest` listeners**. A listener registered with `"blocking"` can return a
`Promise`, and Firefox will hold the request open until the promise resolves.
This is the foundation of the Firefox approach.

## The payment flow

```
User navigates to paid URL
         │
         ▼
 onBeforeSendHeaders fires          ← no pending payment yet, passes through
         │
         ▼
   Request goes to server
         │
         ▼
  Server returns HTTP 402
  with x-bsv-sats and x-bsv-server headers
         │
         ▼
 onHeadersReceived fires
   • stores payment params in pendingPayments map (keyed by tabId)
   • records the requestId of this 402'd request
   • calls setTimeout(() => browser.tabs.update(tabId, { url }), 0)
         │
         ▼  (after current event cycle completes)
 browser.tabs.update triggers a fresh navigation
         │
         ▼
 onBeforeSendHeaders fires again
   • tab has a pending payment ✓
   • URL matches ✓
   • requestId is NEW (not the 402'd one) ✓
   • returns a Promise that calls constructPayment(...)
         │
         ▼  (Promise resolves — Firefox holds the request open)
 Wallet constructs BRC-0121 payment transaction
         │
         ▼
 Promise resolves with { requestHeaders: [...original, ...paymentHeaders] }
         │
         ▼
 Firefox sends the request with payment headers attached
         │
         ▼
  Server returns HTTP 200 ✓
```

## The requestId guard — why it's necessary

`onBeforeSendHeaders` fires for every outgoing HTTP request. When a link is
clicked and the server returns 402, Firefox internally re-fires
`onBeforeSendHeaders` on the **same requestId** as part of its error-page
handling pipeline. Without the guard, we would attempt to inject payment
headers into that internal re-fire — which either does nothing (the request
already completed) or injects into the wrong request.

By storing `details.requestId` from `onHeadersReceived` and skipping any
`onBeforeSendHeaders` call that carries the same `requestId`, we guarantee
we only inject into the fresh navigation driven by `tabs.update`.

```
requestId "42"  →  original request  →  402  →  stored in pending
requestId "42"  →  Firefox internal re-fire  →  SKIPPED (same requestId)
requestId "43"  →  tabs.update retry  →  INJECTED ✓
```

## Why tabs.update is used (not a pure onBeforeSendHeaders approach)

An earlier version attempted to skip `tabs.update` entirely and rely purely on
the user re-navigating (back + click, or browser reload). This worked for
reloads but failed for link clicks because Firefox's internal error-page
pipeline consumes the retry opportunity before the user can act. Driving the
retry explicitly with `tabs.update` makes the flow deterministic regardless
of how the original navigation was initiated.

The `setTimeout(..., 0)` is necessary to let the current `onHeadersReceived`
event cycle complete before the navigation fires, avoiding a re-entrant call
into the webRequest pipeline from within a webRequest listener.

## Key differences from Chrome

| Concern | Chrome | Firefox |
|---|---|---|
| Background context | Service worker (`service_worker`) | Persistent page (`scripts`) |
| Header injection mechanism | `declarativeNetRequest` session rules | `webRequest.onBeforeSendHeaders` with `"blocking"` + Promise |
| Retry trigger | `chrome.tabs.update` after DNR rule installed | `browser.tabs.update` after `onHeadersReceived` |
| `extraHeaders` needed | Yes (for some restricted headers) | No (all headers exposed by default) |
| API namespace | `chrome.*` | `browser.*` |
| Async blocking listeners | No (MV3 removed blocking webRequest) | Yes |
| Manifest background key | `"service_worker": "dist/background.js"` | `"scripts": ["dist/background.js"]` |
| Gecko extension ID | N/A | Required in `browser_specific_settings.gecko.id` |

## Permissions

- `webRequest` — observe HTTP requests and responses
- `webRequestBlocking` — hold requests open and modify headers (Firefox-only)
- `tabs` — call `browser.tabs.update` to trigger retry navigation
- `host_permissions: ["<all_urls>"]` — apply to all sites

`declarativeNetRequest` is **not** needed in Firefox and is omitted.

## Re-entrancy and cleanup

- **Double-402**: if the server returns 402 again after a payment attempt (i.e.,
  payment rejected), `onHeadersReceived` finds an existing entry in
  `pendingPayments` for that tab, logs a warning, clears state, and stops.
- **Tab closed**: `tabs.onRemoved` clears the pending entry.
- **Stale payments**: a `setInterval` clears entries older than 5 minutes, in
  case the wallet never responds or the user abandons the page.
