import "dotenv/config";
import type { Network } from "@x402/core/types";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name} (see .env.example)`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  // Base Sepolia testnet, in CAIP-2 form. x402 v2 uses CAIP-2 network ids.
  network: (process.env.X402_NETWORK ?? "eip155:84532") as Network,
  // Public test facilitator run by the x402 project. It verifies signatures and
  // submits the USDC transfer on-chain on our behalf.
  facilitatorUrl: process.env.FACILITATOR_URL ?? "https://x402.org/facilitator",
  // Address that receives the payments.
  payTo: required("PAY_TO") as `0x${string}`,
};
