import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import type { RoutesConfig } from "@x402/core/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { config } from "./config.js";

// One place that declares what costs money. Handlers stay payment-agnostic.
// Prices are in USD and are converted by the SDK to the network's default
// stablecoin (USDC on Base Sepolia, 6 decimals).
const paidRoutes: RoutesConfig = {
  "GET /premium/quote": {
    accepts: {
      scheme: "exact",
      price: "$0.01",
      network: config.network,
      payTo: config.payTo,
    },
    description: "Full order-book quote",
    mimeType: "application/json",
  },
  "GET /premium/report": {
    accepts: {
      scheme: "exact",
      price: "$0.05",
      network: config.network,
      payTo: config.payTo,
    },
    description: "Daily market report",
    mimeType: "application/json",
  },
};

export function createPaywall() {
  const facilitator = new HTTPFacilitatorClient({ url: config.facilitatorUrl });

  // The resource server knows which payment schemes we accept on which
  // networks. "exact" = pay exactly the listed price, implemented on EVM via
  // EIP-3009 transferWithAuthorization (a signed, gasless USDC transfer).
  const resourceServer = new x402ResourceServer(facilitator).register(
    config.network,
    new ExactEvmScheme(),
  );

  return paymentMiddleware(paidRoutes, resourceServer);
}
