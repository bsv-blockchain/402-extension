# Privacy Policy — BSV 402 Payments Chrome Extension

Last updated: April 1, 2026

## Overview

BSV 402 Payments is a Chrome extension that handles HTTP 402 Payment Required
responses by constructing micropayments through the user's own BSV wallet.
This extension collects no personal data of any kind.

## Data Collection

This extension does not collect, store, transmit, or share any user data.
Specifically:

- No personally identifiable information
- No browsing history or web activity
- No financial information (the extension does not handle keys, balances, or
  account details — all payment operations are delegated to the user's
  external wallet)
- No analytics, telemetry, or usage tracking
- No cookies or local storage
- No authentication credentials

## Network Activity

The extension makes two types of network requests, both initiated only when
a website returns HTTP 402 with BRC-0121 protocol headers:

1. **Local wallet communication** — JSON API calls to the user's own BSV
   wallet (typically running on localhost) to construct a payment transaction.
   No data is sent to any remote server.

2. **Page navigation retry** — After payment headers are installed, the
   extension reloads the page the user was already navigating to. This is a
   standard browser navigation to the same URL.

No other network requests are made. No data is sent to the extension
developer or any third party.

## Data Storage

The extension stores no persistent data. The only state maintained is a
transient in-memory map of in-flight payment requests, which is cleared
when the tab is closed, the user navigates away, or the browser restarts.

## Permissions

The extension requests broad host permissions and network observation
capabilities solely to detect HTTP 402 responses across any website. These
permissions are not used to read, modify, or store page content, browsing
history, or any user data.

## Third Parties

No user data is shared with, sold to, or transferred to any third party.

## Changes

If this privacy policy is updated, the changes will be reflected in this
document in the extension's source repository.

## Contact

For privacy questions, contact support@bsvblockchain.org.
