import express from "express";
import { config } from "./config.js";
import { createPaywall } from "./paywall.js";
import { routes } from "./routes.js";

const app = express();

// The paywall runs before the routes: unpaid requests to paid routes get a 402
// and never reach the handler; everything else passes through untouched.
app.use(createPaywall());
app.use(routes);

app.listen(config.port, () => {
  console.log(`listening on http://localhost:${config.port}`);
  console.log(`paid routes settle to ${config.payTo} on ${config.network} via ${config.facilitatorUrl}`);
});
