import express from "express";
import { createServer } from "http";
import quickTradeRouter from "./routes/quickTrade";
import marketsRouter from "./routes/markets";
import accountRouter from "./routes/account";
import sessionRouter from "./routes/session";
import pairsRouter from "./routes/pairs";
import { ensureRuntimePrereqs } from "./bootstrap/dbEnsure";
import { setupVite, serveStatic } from "./vite";

const app = express();
const server = createServer(app);

app.use(express.json());

// minimal CORS (no external deps)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-request-id",
  );
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// request trace
app.use((req, _res, next) => {
  const rid = req.headers["x-request-id"] || "";
  console.log(
    JSON.stringify({ msg: "req", method: req.method, url: req.originalUrl, rid }),
  );
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
    console.error(
      JSON.stringify({ msg: "dbEnsure", ok: false, err: e?.message || String(e) }),
    );
  }

  // API mount (router paths are WITHOUT '/api' prefix)
  app.use("/api", sessionRouter);
  app.use("/api", accountRouter);
  app.use("/api", quickTradeRouter);
  app.use("/api", marketsRouter);
  app.use("/api", pairsRouter);

  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  }

  // 404 JSON for unknown API routes
  app.use((req, res, next) => {
    if (req.originalUrl.startsWith("/api")) {
      return res.status(404).json({ ok: false, message: "Not Found" });
    }

    next();
  });

  const PORT = Number(process.env.PORT || 5000);
  server.listen(PORT, () =>
    console.log(JSON.stringify({ msg: "listening", port: PORT })),
  );
})();

export default app;
