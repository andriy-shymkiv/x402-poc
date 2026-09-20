import "dotenv/config";
import { x402Client, x402HTTPClient } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

// This client walks through the x402 handshake step by step and logs each
// stage. In real code you would use wrapFetchWithPayment(fetch, client) from
// @x402/fetch, which does exactly these steps behind a normal fetch call.

const baseUrl = process.env.API_URL ?? "http://localhost:3000";
const privateKey = process.env.CLIENT_PRIVATE_KEY;
if (!privateKey || !privateKey.startsWith("0x") || privateKey.length !== 66) {
  throw new Error("CLIENT_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key (see .env.example)");
}

// The account only needs to sign EIP-712 typed data. It never sends a
// transaction itself, so it needs no ETH for gas, only USDC to pay with.
const account = privateKeyToAccount(privateKey as `0x${string}`);

const client = new x402HTTPClient(
  new x402Client().register("eip155:*", new ExactEvmScheme(account)),
);

function decodeHeader(value: string | null) {
  return value ? JSON.parse(Buffer.from(value, "base64").toString("utf8")) : null;
}

function log(step: string, data?: unknown) {
  console.log(`\n== ${step}`);
  if (data !== undefined) console.log(JSON.stringify(data, null, 2));
}

async function callFree() {
  const res = await fetch(`${baseUrl}/quote`);
  log(`GET /quote -> ${res.status}`, await res.json());
}

async function callPaid(path: string) {
  // 1. Plain request. The server answers 402 and describes what it wants.
  const first = await fetch(`${baseUrl}${path}`, { headers: { Accept: "application/json" } });
  log(`GET ${path} -> ${first.status}`);
  if (first.status !== 402) {
    log("unexpected: not paywalled", await first.text());
    return;
  }

  const paymentRequired = client.getPaymentRequiredResponse(
    (name) => first.headers.get(name),
    await first.json(),
  );
  log("PAYMENT-REQUIRED (decoded)", paymentRequired);

  // 2. Pick an option and sign it. For the "exact" EVM scheme this signs an
  //    EIP-3009 transferWithAuthorization for the USDC contract: "anyone may
  //    move <amount> from me to <payTo>, valid between validAfter and
  //    validBefore, once, identified by this nonce". Nothing touches the chain
  //    yet; it's an offline signature.
  const paymentPayload = await client.createPaymentPayload(paymentRequired);
  log("PAYMENT-SIGNATURE payload (before base64 encoding)", paymentPayload);

  // 3. Retry the same request carrying the signed payment in a header.
  const headers = client.encodePaymentSignatureHeader(paymentPayload);
  const second = await fetch(`${baseUrl}${path}`, {
    headers: { Accept: "application/json", ...headers },
  });
  log(`GET ${path} with payment -> ${second.status}`);

  if (second.status === 402) {
    // The facilitator rejected the payment (typically insufficient USDC
    // balance or an expired/invalid signature). The reason is in the header.
    const rejected = decodeHeader(second.headers.get("PAYMENT-REQUIRED"));
    log("payment rejected", { error: rejected?.error, from: account.address });
    return;
  }

  // 4. The server asked the facilitator to verify and settle the transfer
  //    on-chain, then returned the resource plus a receipt header.
  const body = await second.json();
  log("response body", body);

  const settlement = decodeHeader(second.headers.get("PAYMENT-RESPONSE"));
  if (settlement) {
    log("PAYMENT-RESPONSE (settlement receipt)", settlement);
    if (settlement.transaction) {
      console.log(`\nexplorer: https://sepolia.basescan.org/tx/${settlement.transaction}`);
    }
  }
}

console.log(`paying from ${account.address}`);
await callFree();
await callPaid(process.env.PAID_PATH ?? "/premium/quote");
