# BSV 402 Payments — Chrome Extension

A Manifest V3 Chrome extension that transparently handles [BRC-121](https://brc.dev/121) payments for HTTP `402 Payment Required` responses. When a server demands payment for a resource, the extension automatically constructs a BSV transaction via any available [BRC-100](https://brc.dev/100) wallet and retries the request with the payment attached — all without the user leaving the page.

## How It Works

```
Browser navigates to a protected URL
        │
        ▼
Server returns 402 + x-bsv-sats + x-bsv-server headers
        │
        ▼
Service worker reads the response headers (webRequest API)
        │
        ▼
WalletClient('auto') discovers an available BRC-100 wallet
  ├── BSV Desktop (localhost:3321)
  ├── Cicada (localhost:3301)
  └── any other available substrate
        │
        ▼
Extension derives a BRC-29 payment key, builds a P2PKH
transaction via the wallet, and encodes it as BEEF
        │
        ▼
declarativeNetRequest session rules attach 5 payment headers
to the retry request (x-bsv-sender, x-bsv-beef, x-bsv-prefix,
x-bsv-suffix, x-bsv-vout)
        │
        ▼
chrome.tabs.update() retries the navigation
        │
        ▼
Server validates the payment, serves the content (200 OK)
        │
        ▼
Session rules cleaned up automatically
```

## Specs Implemented

| Spec | Role |
|------|------|
| [BRC-121](https://brc.dev/121) — Simple 402 Payments | The payment protocol: 402 response with `x-bsv-sats`/`x-bsv-server` headers, retry with `x-bsv-beef`/`x-bsv-sender`/`x-bsv-prefix`/`x-bsv-suffix`/`x-bsv-vout` headers |
| [BRC-100](https://brc.dev/100) — Wallet Interface | The wallet communication layer, via `WalletClient` from `@bsv/sdk` with automatic substrate discovery |

BRC-121 builds on [BRC-29](https://brc.dev/29) (payment derivation) and [BRC-95](https://brc.dev/95) (BEEF transaction format).

## Architecture

The extension is a single service worker — no popup, no content scripts, no UI. It operates entirely in the background:

- **`webRequest.onHeadersReceived`** observes all HTTP responses. On a 402 with BRC-121 headers, it initiates the payment flow.
- **`WalletClient`** from `@bsv/sdk` connects to whichever BRC-100 wallet substrate is available (BSV Desktop, Cicada, or others).
- **`declarativeNetRequest.updateSessionRules()`** installs temporary rules that attach the payment headers to the retry request.
- **`chrome.tabs.update()`** triggers the retry navigation.
- Rules are cleaned up on request completion, error, tab close, or navigation away.

### Infinite Loop Prevention

If a retry itself returns 402 (payment rejected by the server), the extension does not retry again. A per-tab `pendingPayments` map guards against re-entrant handling. Stale payments are cleaned up after 5 minutes.

## Project Structure

```
402-extension/
├── manifest.json              # MV3 manifest
├── package.json               # Dependencies
├── tsconfig.json              # TypeScript config
├── build.ts                   # esbuild bundler
├── src/
│   ├── background.ts          # Service worker: webRequest, DNR rules, retry
│   ├── payment-handler.ts     # BRC-121 payment construction via WalletClient
│   └── types.ts               # Shared type definitions
├── icons/                     # Extension icons
└── dist/                      # Build output (gitignored)
    └── background.js          # Bundled service worker (~650KB with @bsv/sdk)
```

## Prerequisites

A BRC-100 compatible wallet must be running for the extension to construct payments. [BSV Desktop](https://github.com/bsv-blockchain/bsv-desktop) exposes its wallet on `localhost:3321` and is discovered automatically.

## Build

```bash
npm install
npm run build
```

## Install in Chrome

1. Run `npm run build`
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked** and select this directory
5. The service worker activates and begins intercepting 402 responses

## Development

```bash
npm run watch
```

This watches for source changes and rebuilds `dist/background.js` automatically. After a rebuild, go to `chrome://extensions` and click the reload button on the extension.

## License

Open BSV License.
