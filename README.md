# x402 POC

A minimal Express + TypeScript server with two free endpoints and two paid ones,
plus a client that pays for them. The goal is to see every step of the
[x402](https://x402.org) protocol on the wire.

## What x402 is

HTTP has had a `402 Payment Required` status code since 1997 and never used it.
x402 gives it a concrete meaning:

1. Client requests a resource.
2. Server answers `402` with a `PAYMENT-REQUIRED` header describing acceptable
   payments (network, token, amount, recipient, time window).
3. Client picks one option and **signs** a payment authorization. On EVM chains
   this is an [EIP-3009](https://eips.ethereum.org/EIPS/eip-3009)
   `transferWithAuthorization` for USDC: an offline EIP-712 signature that lets
   anyone move exactly `amount` from the payer to `payTo`, once, within a validity
   window. No transaction is sent and the payer needs no ETH for gas.
4. Client retries the same request with the signed payload in a
   `PAYMENT-SIGNATURE` header.
5. Server forwards the payload to a **facilitator**, which verifies the signature
   and the payer's balance, then submits the transfer on-chain (paying gas
   itself). The server runs the handler and returns the resource together with a
   `PAYMENT-RESPONSE` header carrying the transaction hash as a receipt.

```
client                         server                         facilitator        chain
  | GET /premium/quote           |                                |                 |
  |----------------------------->|                                |                 |
  | 402 + PAYMENT-REQUIRED       |                                |                 |
  |<-----------------------------|                                |                 |
  | sign EIP-3009 authorization (offline)                         |                 |
  | GET /premium/quote + PAYMENT-SIGNATURE                        |                 |
  |----------------------------->| verify(payload)                |                 |
  |                              |------------------------------->| check sig, balance
  |                              |<-------------------------------|                 |
  |                              | run handler                    |                 |
  |                              | settle(payload)                |                 |
  |                              |------------------------------->| transferWithAuthorization
  |                              |                                |---------------->|
  |                              |<-------------------------------| tx hash         |
  | 200 + body + PAYMENT-RESPONSE|                                |                 |
  |<-----------------------------|                                |                 |
```

The server never touches private keys or RPC nodes. It only declares prices and
talks HTTP to the facilitator. This POC uses the public test facilitator at
`https://x402.org/facilitator` on Base Sepolia (`eip155:84532`, CAIP-2 form).

## Layout

| File | Role |
| --- | --- |
| `src/routes.ts` | Plain Express handlers. They know nothing about payments. |
| `src/paywall.ts` | Declares which routes cost what and builds the x402 middleware. |
| `src/config.ts` | Loads `PAY_TO`, network and facilitator URL from `.env`. |
| `src/server.ts` | Mounts the paywall in front of the routes. |
| `src/client.ts` | Walks through the handshake step by step and logs each stage. |

Server packages: `@x402/express` (middleware), `@x402/core` (protocol types,
facilitator HTTP client), `@x402/evm` (the `exact` scheme for EVM chains).
Client packages: `@x402/fetch`, `@x402/evm`, `viem` (for the signing account).

## Run it

```bash
npm install
cp .env.example .env
```

Edit `.env`:

- `PAY_TO`: an address you control. It receives the USDC.
- `CLIENT_PRIVATE_KEY`: a **testnet-only** wallet. To see a settled payment it
  needs Base Sepolia USDC (contract `0x036CbD53842c5426634e7929541eC2318f3dCF7e`),
  available from the [Circle faucet](https://faucet.circle.com). It needs no ETH.

Start the server:

```bash
npm start
```

### Watch the 402 by hand

```bash
curl -s -i -H "Accept: application/json" localhost:3000/premium/quote
```

Decode the requirements header:

```bash
curl -s -D - -o /dev/null -H "Accept: application/json" localhost:3000/premium/quote \
  | grep -i '^payment-required' | cut -d' ' -f2 | tr -d '\r' | base64 -d | python3 -m json.tool
```

You get something like:

```json
{
  "x402Version": 2,
  "error": "Payment required",
  "resource": { "url": "http://localhost:3000/premium/quote", "description": "Full order-book quote", "mimeType": "application/json" },
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:84532",
    "amount": "10000",
    "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    "payTo": "0x...",
    "maxTimeoutSeconds": 300,
    "extra": { "name": "USDC", "version": "2" }
  }]
}
```

`amount` is in token base units: USDC has 6 decimals, so `10000` = $0.01. The
SDK converted the `price: "$0.01"` from `paywall.ts` using its built-in asset
table for the network. `extra` is the EIP-712 domain the client must sign under.

Without an `Accept: application/json` header the middleware assumes a browser and
serves a small HTML paywall page instead. The JSON header is what API clients get.

### Pay for it

In a second terminal:

```bash
npm run client
```

The client logs each stage: the free call, the 402, the decoded requirements,
the signed payload, and the retry. With an unfunded wallet the retry is rejected
and you see the facilitator's reason:

```
== payment rejected
{ "error": "invalid_exact_evm_insufficient_balance", "from": "0x..." }
```

With a funded wallet the retry returns 200, the body, and the decoded
`PAYMENT-RESPONSE` with a transaction hash you can open on Base Sepolia Basescan.

Set `PAID_PATH=/premium/report` to hit the $0.05 endpoint instead.

## The short version of the client

`src/client.ts` is deliberately verbose. In an application you would write:

```ts
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(process.env.CLIENT_PRIVATE_KEY as `0x${string}`);
const client = new x402Client().register("eip155:*", new ExactEvmScheme(account));
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

const res = await fetchWithPayment("http://localhost:3000/premium/quote");
```

`fetchWithPayment` performs the 402 / sign / retry loop internally and returns
the final response.

## Things worth knowing

- **Replay protection** comes from the EIP-3009 nonce: the USDC contract records
  each used nonce, so a captured `PAYMENT-SIGNATURE` cannot be spent twice.
- **Validity window**: `validBefore` is set from `maxTimeoutSeconds`. A slow
  facilitator or a retried request after expiry fails verification.
- **Settle after handler**: the middleware verifies before running your handler
  and settles after it. If the handler throws or returns an error status, the
  payment is not settled, so the payer isn't charged for a failed response.
- **Facilitator trust**: the facilitator submits the transaction and pays gas. It
  cannot redirect funds because the signed authorization fixes `to` and `value`.
  For production you would run your own or use a hosted one (for example
  Coinbase's, which requires API keys), and switch `X402_NETWORK` to Base
  mainnet `eip155:8453`.
- **Version**: this uses x402 v2 (`@x402/*` 2.x). The older `x402-express` 1.x
  package has a different API and network naming (`base-sepolia` instead of
  `eip155:84532`).
