import express from "express";
import cors from "cors";
import morgan from "morgan";
import quickTradeRouter from "./routes/quickTrade";

const app = express();

app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

app.use((req, _res, next) => {
  console.log(`[req] ${req.method} ${req.originalUrl}`);
  next();
});

app.get("/healthz", (_req, res) => res.status(200).send("ok"));

// FONTOS: /api alá mountoljuk; a routerben NINCS /api előtag.
app.use("/api", quickTradeRouter);

app.use((req, res) => {
  console.warn(`[404] ${req.method} ${req.originalUrl}`);
  res.status(404).json({ ok: false, message: "Not Found" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[server] listening on :${PORT}`));

export default app;
