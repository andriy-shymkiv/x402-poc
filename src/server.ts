import express from "express";
import { routes } from "./routes.js";

const PORT = Number(process.env.PORT ?? 3000);

const app = express();
app.use(routes);

app.listen(PORT, () => {
  console.log(`listening on http://localhost:${PORT}`);
});
