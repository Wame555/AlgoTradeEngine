import "dotenv/config";
import http from "node:http";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";

import quickTradeRouter from "./routes/quickTrade";
import marketsRouter from "./routes/markets";
import { registerRoutes } from "./routes";
import { PaperBroker } from "./paper/PaperBroker";
import { BinanceService, type PriceData } from "./services/binanceService";
import { IndicatorService } from "./services/indicatorService";
import { TelegramService } from "./services/telegramService";
import { loadAccountSnapshotFromDB, updateAccountSnapshot } from "./state/accountSnapshot";
import { db } from "./db";
import { paperAccounts } from "@shared/schemaPaper";
import { eq } from "drizzle-orm";
import { setLastPrice as setPaperLastPrice } from "./paper/PriceFeed";
import { setLastPrice as setMarketLastPrice } from "./state/marketCache";
import { bootstrapMarketCaches } from "./services/cacheBootstrap";
import { CONFIGURED_SYMBOLS } from "./config/symbols";
import { SUPPORTED_TIMEFRAMES } from "@shared/types";
import { serveStatic, setupVite } from "./vite";

const app = express();

app.use(express.json());

app.use((req, _res, next) => {
  console.log(`[req] ${req.method} ${req.originalUrl}`);
  next();
});

const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
const wsClients = new Set<WebSocket>();
const latestPrices = new Map<string, PriceData>();

function broadcast(message: any): void {
  const payload = JSON.stringify(message);
  wsClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(payload);
      } catch (error) {
        console.warn("[ws] failed to send payload", error);
      }
      return;
    }

    if (client.readyState === WebSocket.CLOSING || client.readyState === WebSocket.CLOSED) {
      wsClients.delete(client);
    }
  });
}

wss.on("connection", (socket) => {
  wsClients.add(socket);
  const handshake = { type: "connection", ts: new Date().toISOString() };
  try {
    socket.send(JSON.stringify(handshake));
  } catch (error) {
    console.warn("[ws] handshake send failed", error);
  }

  let encounteredError = false;
  latestPrices.forEach((priceUpdate) => {
    if (encounteredError) {
      return;
    }
    try {
      socket.send(JSON.stringify({ type: "price_update", data: priceUpdate }));
    } catch (error) {
      console.warn("[ws] failed to send cached price", error);
      encounteredError = true;
    }
  });

  socket.on("close", () => {
    wsClients.delete(socket);
  });

  socket.on("error", (error) => {
    console.warn("[ws] client error", error);
    wsClients.delete(socket);
  });
});

const broker = new PaperBroker();

loadAccountSnapshotFromDB()
  .then(async (snapshot) => {
    if (!snapshot) {
      return;
    }
    updateAccountSnapshot({ totalBalance: snapshot.totalBalance, equity: snapshot.equity });
    try {
      const [account] = await db.select().from(paperAccounts).limit(1);
      if (account) {
        await db
          .update(paperAccounts)
          .set({ balance: snapshot.totalBalance.toString() })
          .where(eq(paperAccounts.id, account.id));
      } else {
        await db.insert(paperAccounts).values({ balance: snapshot.totalBalance.toString() });
      }
    } catch (error) {
      console.warn(`[account] failed to restore paper balance: ${(error as Error).message ?? error}`);
    }
  })
  .catch((error) => {
    console.warn(`[account] failed to load persisted snapshot: ${(error as Error).message ?? error}`);
  });
const binanceService = new BinanceService();
const indicatorService = new IndicatorService();
const telegramService = new TelegramService();
const configuredSymbols = Array.from(CONFIGURED_SYMBOLS);
const supportedTimeframes = Array.from(SUPPORTED_TIMEFRAMES);

const isProduction = process.env.NODE_ENV === "production";
const isTest = process.env.NODE_ENV === "test";

const registerNotFoundHandler = (application: express.Express) => {
  application.use((req, res) => {
    console.warn(`[404] ${req.method} ${req.originalUrl}`);
    res.status(404).json({ ok: false, message: "Not Found" });
  });
};

registerRoutes(app, {
  broker,
  binanceService,
  telegramService,
  indicatorService,
  broadcast,
});

app.use("/api", quickTradeRouter);
app.use("/api", marketsRouter);

if (isProduction) {
  try {
    serveStatic(app);
  } catch (error) {
    console.warn("[static] failed to configure static assets", error);
  }
  registerNotFoundHandler(app);
} else if (!isTest) {
  void setupVite(app, httpServer)
    .then(() => {
      registerNotFoundHandler(app);
    })
    .catch((error) => {
    console.error("[vite] failed to initialise development server", error);
    process.exit(1);
  });
} else {
  registerNotFoundHandler(app);
}

async function initializeServices(): Promise<void> {
  try {
    const bootstrapResult = await bootstrapMarketCaches(configuredSymbols, supportedTimeframes);
    if (!bootstrapResult.ready) {
      console.warn("[bootstrap] market caches primed with limited data", bootstrapResult);
    }
  } catch (error) {
    console.warn("[bootstrap] failed to prime market caches", error);
  }

  try {
    await binanceService.initializeTradingPairs();
  } catch (error) {
    console.warn("[binance] failed to initialise trading pairs", error);
  }

  binanceService.startPriceStreams((update) => {
    if (update?.symbol) {
      latestPrices.set(update.symbol, update);
      const numericPrice = Number(update.price);
      if (Number.isFinite(numericPrice)) {
        setPaperLastPrice(update.symbol, numericPrice);
        setMarketLastPrice(update.symbol, numericPrice);
      }
    }
    broadcast({ type: "price_update", data: update });
  });
}

void initializeServices();

const PORT = Number(process.env.PORT) || 3000;
httpServer.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`);
});

export default app;
