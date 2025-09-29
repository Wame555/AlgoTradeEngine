import express from "express";
import type { Express } from "express";
import { createServer } from "http";
import type { Server } from "http";
import { WebSocketServer, type WebSocket } from "ws";
import { eq, sql } from "drizzle-orm";

import { ensureRuntimePrereqs } from "./bootstrap/dbEnsure";
import { setupVite, serveStatic } from "./vite";
import { registerRoutes, ensureDefaultUser } from "./routes";
import { PaperBroker } from "./paper/PaperBroker";
import { BinanceService } from "./services/binanceService";
import { TelegramService } from "./services/telegramService";
import { IndicatorService } from "./services/indicatorService";
import { bootstrapMarketCaches } from "./services/cacheBootstrap";
import { loadAccountSnapshotFromDisk, loadAccountSnapshotFromDB, updateAccountSnapshot } from "./state/accountSnapshot";
import { DEFAULT_PAIRS } from "./config/defaultPairs";
import { SUPPORTED_TIMEFRAMES } from "@shared/types";
import { db } from "./db";
import { tradingPairs } from "@shared/schema";

const PORT = Number(process.env.PORT || 5000);
const NODE_ENV = process.env.NODE_ENV ?? "development";

function createBroadcast(server: Server) {
  const wss = new WebSocketServer({ server, path: "/ws" });
  const clients = new Set<WebSocket>();

  wss.on("connection", (socket) => {
    clients.add(socket);
    socket.on("close", () => {
      clients.delete(socket);
    });
  });

  return {
    broadcast(data: unknown) {
      const payload = JSON.stringify(data);
      clients.forEach((socket) => {
        if (socket.readyState === socket.OPEN) {
          try {
            socket.send(payload);
          } catch (error) {
            clients.delete(socket);
          }
        }
      });
    },
  };
}

async function seedDefaultTradingPairs(): Promise<void> {
  const result = await db.execute<{ count: string }>(sql`SELECT COUNT(*)::text AS count FROM public."trading_pairs";`);
  const row = (result as any)?.rows?.[0];
  const existingCount = Number(row?.count ?? 0);
  if (Number.isFinite(existingCount) && existingCount > 0) {
    return;
  }

  for (const symbol of DEFAULT_PAIRS) {
    const baseAsset = symbol.replace(/USDT$/i, "");
    const quoteAsset = symbol.endsWith("USDT") ? "USDT" : symbol.endsWith("USD") ? "USD" : "USDT";
    await db.execute(
      sql`
        INSERT INTO public."trading_pairs" (symbol, base_asset, quote_asset, is_active)
        VALUES (${symbol}, ${baseAsset}, ${quoteAsset}, true)
        ON CONFLICT ON CONSTRAINT trading_pairs_symbol_uniq DO UPDATE
        SET
          base_asset = EXCLUDED.base_asset,
          quote_asset = EXCLUDED.quote_asset,
          is_active = EXCLUDED.is_active;
      `,
    );
  }
}

async function initializeTradingPairs(service: BinanceService): Promise<void> {
  try {
    await service.initializeTradingPairs();
  } catch (error) {
    console.warn("[bootstrap] failed to sync trading pairs from Binance:", error instanceof Error ? error.message : error);
  }
  await seedDefaultTradingPairs();
}

async function bootstrapCaches(): Promise<void> {
  try {
    const symbolsResult = await db
      .select({ symbol: tradingPairs.symbol })
      .from(tradingPairs)
      .where(eq(tradingPairs.isActive, true));
    const symbols = symbolsResult.map((row) => row.symbol);
    const timeframes = Array.from(new Set([...SUPPORTED_TIMEFRAMES]));
    await bootstrapMarketCaches(symbols, timeframes);
  } catch (error) {
    console.warn("[bootstrap] failed to prime market caches:", error instanceof Error ? error.message : error);
  }
}

async function restoreAccountSnapshot(): Promise<void> {
  const diskSnapshot = await loadAccountSnapshotFromDisk();
  if (diskSnapshot) {
    updateAccountSnapshot(diskSnapshot);
    return;
  }

  const dbSnapshot = await loadAccountSnapshotFromDB();
  if (dbSnapshot) {
    updateAccountSnapshot(dbSnapshot);
  }
}

async function bootstrap(app: Express, server: Server): Promise<void> {
  await ensureRuntimePrereqs();

  const broker = new PaperBroker();
  const binanceService = new BinanceService();
  const telegramService = new TelegramService();
  const indicatorService = new IndicatorService();

  await initializeTradingPairs(binanceService);
  await restoreAccountSnapshot();
  await ensureDefaultUser().catch((error) => {
    console.warn("[bootstrap] ensureDefaultUser failed:", error instanceof Error ? error.message : error);
  });
  await bootstrapCaches();

  const { broadcast } = createBroadcast(server);

  registerRoutes(app, {
    broker,
    binanceService,
    telegramService,
    indicatorService,
    broadcast,
  });
}

async function startServer(): Promise<void> {
  const app = express();
  const server = createServer(app);

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-request-id");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use((req, _res, next) => {
    const rid = req.headers["x-request-id"] ?? "";
    console.log(JSON.stringify({ msg: "req", method: req.method, url: req.originalUrl, rid }));
    next();
  });

  await bootstrap(app, server);

  if (NODE_ENV === "development") {
    await setupVite(app, server);
  } else if (NODE_ENV === "production") {
    serveStatic(app);
  }

  app.use((req, res, next) => {
    if (req.originalUrl.startsWith("/api")) {
      res.status(404).json({ ok: false, message: "Not Found" });
      return;
    }
    next();
  });

  server.listen(PORT, () => {
    console.log(JSON.stringify({ msg: "listening", port: PORT }));
  });
}

void startServer().catch((error) => {
  console.error("[server] fatal bootstrap error", error);
  process.exitCode = 1;
});
