import express from "express";
import morgan from "morgan";
import quickTradeRouter from "./routes/quickTrade";

const app = express();

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS"
  );
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
});
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
