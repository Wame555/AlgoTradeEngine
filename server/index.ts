import express from "express";
import quickTradeRouter from "./routes/quickTrade";
import marketsRouter from "./routes/markets";

const app = express();

app.use(express.json());

app.use((req, _res, next) => {
  console.log(`[req] ${req.method} ${req.originalUrl}`);
  next();
});

app.get("/healthz", (_req, res) => res.status(200).send("ok"));

// Mount API (router paths are plain, without /api prefix)
app.use("/api", quickTradeRouter);
app.use("/api", marketsRouter);

app.use((req, res) => {
  console.warn(`[404] ${req.method} ${req.originalUrl}`);
  res.status(404).json({ ok: false, message: "Not Found" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[server] listening on :${PORT}`));

export default app;
