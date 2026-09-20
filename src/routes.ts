import { Router } from "express";

// Plain business logic. Nothing here knows about payments; the paywall is
// applied in server.js as middleware in front of these handlers.
export const routes = Router();

routes.get("/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Free endpoint: a rough quote with little detail.
routes.get("/quote", (_req, res) => {
  res.json({ pair: "ETH/USD", price: 3200, tier: "free" });
});

// Endpoints under /premium will be paywalled in step 2.
routes.get("/premium/quote", (_req, res) => {
  res.json({
    pair: "ETH/USD",
    price: 3201.37,
    bid: 3201.1,
    ask: 3201.6,
    tier: "premium",
  });
});

routes.get("/premium/report", (_req, res) => {
  res.json({
    title: "Daily market report",
    summary: "Volatility low, funding flat, nothing to see here.",
    tier: "premium",
  });
});
