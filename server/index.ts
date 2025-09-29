import express from "express";
import quickTradeRouter from "./routes/quickTrade";
import marketsRouter from "./routes/markets";
import accountRouter from "./routes/account";
import { ensureRuntimePrereqs } from "./bootstrap/dbEnsure";

const app = express();
app.use(express.json());

// minimal CORS (no external deps)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-request-id");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// request trace
app.use((req, _res, next) => {
  const rid = req.headers["x-request-id"] || "";
  console.log(JSON.stringify({ msg: "req", method: req.method, url: req.originalUrl, rid }));
  next();
});

// health first
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

(async () => {
  // **Ensure DB prerequisites exist before any route uses them**
  try {
    await ensureRuntimePrereqs();
    console.log(JSON.stringify({ msg: "dbEnsure", ok: true }));
  } catch (e: any) {
    console.error(JSON.stringify({ msg: "dbEnsure", ok: false, err: e?.message || String(e) }));
  }

  // API mount (router paths are WITHOUT '/api' prefix)
  app.use("/api", accountRouter);
  app.use("/api", quickTradeRouter);
  app.use("/api", marketsRouter);

  // 404 JSON
  app.use((req, res) => res.status(404).json({ ok: false, message: "Not Found" }));

  const PORT = Number(process.env.PORT || 5000);
  app.listen(PORT, () => console.log(JSON.stringify({ msg: "listening", port: PORT })));
})();
export default app;
