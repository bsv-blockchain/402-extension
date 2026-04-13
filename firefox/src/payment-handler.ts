import { WalletClient } from '@bsv/sdk'
import { constructPaymentHeaders } from '@bsv/402-pay/client'
import type { PaymentHeaders } from '@bsv/402-pay/client'

/**
 * Cache of WalletClient instances keyed by originator.
 * Each WalletClient binds to a specific originator at construction time,
 * so we need one per origin that triggers a 402 payment.
 */
const walletClients = new Map<string, WalletClient>()

function getWalletClient (originator: string): WalletClient {
  let client = walletClients.get(originator)
  if (!client) {
    client = new WalletClient('auto', originator)
    walletClients.set(originator, client)
  }
  return client
}

/**
 * Construct a BRC-0121 payment for a 402 response.
 *
 * Delegates to @bsv/402-pay's constructPaymentHeaders, managing the
 * per-origin WalletClient lifecycle.
 */
export async function constructPayment (
  url: string,
  sats: number,
  serverKey: string
): Promise<PaymentHeaders> {
  const originator = new URL(url).origin
  const wallet = getWalletClient(originator)
  return constructPaymentHeaders(wallet, url, sats, serverKey)
}
