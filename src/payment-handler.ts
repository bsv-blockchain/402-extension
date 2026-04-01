import { PublicKey, WalletClient } from '@bsv/sdk'
import type { WalletProtocol } from '@bsv/sdk'
import type { PaymentHeaders } from './types.js'

const BRC29_PROTOCOL_ID: WalletProtocol = [2, '3241645161d8']

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
 * Generate 8 random bytes encoded as base64.
 * Uses the Web Crypto API available in service workers.
 */
function randomBase64 (byteLength: number = 8): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/**
 * Construct a BRC-0121 payment for a 402 response.
 *
 * This mirrors the logic from bsv-browser's BsvPaymentHandler:
 * 1. Derive a payment key using BRC-29 protocol
 * 2. Build a P2PKH locking script for the derived key
 * 3. Create a payment transaction via the wallet
 * 4. Return the 5 payment headers for the retry request
 *
 * @param url       The URL that returned 402
 * @param sats      Satoshis required (from x-bsv-sats header)
 * @param serverKey Server identity key (from x-bsv-server header)
 * @returns The payment headers to attach on retry
 */
export async function constructPayment (
  url: string,
  sats: number,
  serverKey: string
): Promise<PaymentHeaders> {
  const originator = new URL(url).origin
  const wallet = getWalletClient(originator)

  // Generate random derivation parameters (BRC-29)
  const derivationPrefix = randomBase64(8)
  const derivationSuffix = randomBase64(8)

  // Derive the payment public key using the server as counterparty
  const { publicKey: derivedPubKey } = await wallet.getPublicKey({
    protocolID: BRC29_PROTOCOL_ID,
    keyID: `${derivationPrefix} ${derivationSuffix}`,
    counterparty: serverKey
  })

  // Compute P2PKH locking script: OP_DUP OP_HASH160 <pkh> OP_EQUALVERIFY OP_CHECKSIG
  const pkh = PublicKey.fromString(derivedPubKey).toHash('hex') as string
  const lockingScript = `76a914${pkh}88ac`

  // Get the sender's identity key
  const { publicKey: senderIdentityKey } = await wallet.getPublicKey({
    identityKey: true
  })

  // Create the payment transaction
  const actionResult = await wallet.createAction({
    description: `Paid Content: ${new URL(url).pathname}`,
    outputs: [{
      satoshis: sats,
      lockingScript,
      outputDescription: '402 web payment',
      customInstructions: JSON.stringify({
        derivationPrefix,
        derivationSuffix,
        serverIdentityKey: serverKey
      }),
      tags: ['402-payment']
    }],
    labels: ['402-payment'],
    options: {
      randomizeOutputs: false
    }
  })

  // Encode the BEEF transaction as base64
  const txBytes = actionResult.tx as number[]
  let binary = ''
  for (let i = 0; i < txBytes.length; i++) {
    binary += String.fromCharCode(txBytes[i])
  }
  const txBase64 = btoa(binary)

  return {
    'x-bsv-sender': senderIdentityKey,
    'x-bsv-beef': txBase64,
    'x-bsv-prefix': derivationPrefix,
    'x-bsv-suffix': derivationSuffix,
    'x-bsv-vout': '0'
  }
}
