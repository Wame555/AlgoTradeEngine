// server/index.ts
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type RequestHandler } from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { setupVite, serveStatic, log } from "./vite";
import { registerRoutes } from "./routes";
import quickTradeRouter from "./routes/quickTrade";
import { configureOrderService } from "./services/orders";

import { PaperBroker } from "./paper/PaperBroker";
import type { Broker } from "./broker/types";

import { BinanceService } from "./services/binanceService";
import { TelegramService } from "./services/telegramService";
import { IndicatorService } from "./services/indicatorService";
import { setLastPrice } from "./paper/PriceFeed";
import { db, pool } from "./db";
import { ensureSchema } from "./db/guards";
import { runFuturesBackfill, BackfillTimeframes } from "./services/backfill";
import { startLiveFuturesStream } from "./services/live";
import { DEFAULT_TIMEFRAMES, initializeMetrics } from "./services/metrics";
import { configureLogging } from "./utils/logger";
import { errorHandler } from "./middleware/errorHandler";
import { CONFIGURED_SYMBOLS } from "./config/symbols";
import { FUTURES, RUN_MIGRATIONS_ON_START, BACKFILL_ON_START, BACKFILL_MIN_CANDLES } from "../src/config/env";
import { runAutoheal } from "../scripts/migrate/autoheal";
import { bootstrapMarketCaches } from "./services/cacheBootstrap";
import {
    getHealthSnapshot,
    getBackfillSnapshot,
    markCacheReady,
    markSymbolsConfigured,
    markWsStatus,
    resetHealthState,
} from "./state/systemHealth";
import { loadAccountSnapshotFromDisk } from "./state/accountSnapshot";

configureLogging();

const environment = (process.env.NODE_ENV ?? "development").toLowerCase();
const shouldLogRequests = (process.env.EXPRESS_DEBUG ?? "false") === "true";
const configuredSymbols = [...CONFIGURED_SYMBOLS];
const hasConfiguredSymbols = configuredSymbols.length > 0;
const migrationsRequired = environment === "production";
const shouldRunMigrations = RUN_MIGRATIONS_ON_START || migrationsRequired;

resetHealthState();
markCacheReady(false);
markWsStatus(FUTURES ? "disconnected" : "disabled");
markSymbolsConfigured(hasConfiguredSymbols);

console.info(`[startup] environment=${environment}`);
console.info(
    `[startup] RUN_MIGRATIONS_ON_START env=${RUN_MIGRATIONS_ON_START ? "true" : "false"} resolved=${
        shouldRunMigrations ? "true" : "false"
    }`,
);
console.info(`[startup] FUTURES=${FUTURES ? "true" : "false"}`);
if (!hasConfiguredSymbols) {
    console.warn("[startup] SYMBOL_LIST is empty. Stats endpoints will return fallback values.");
} else {
    console.info(`[startup] SYMBOL_LIST loaded (${configuredSymbols.length}): ${configuredSymbols.join(", ")}`);
}

const requestLogger: RequestHandler = (req, res, next) => {
    if (!shouldLogRequests) {
        next();
        return;
    }

    const startedAt = Date.now();
    res.on("finish", () => {
        const durationMs = Date.now() - startedAt;
        const status = res.statusCode;
        const method = req.method;
        const url = req.originalUrl;
        console.warn(`[${new Date().toISOString()}] ${method} ${url} -> ${status} (${durationMs}ms)`);
    });
    next();
};

// --- Express app + HTTP szerver ---
const app = express();
if (shouldLogRequests) {
    app.use(requestLogger);
}
app.use(express.json());

app.use((req, _res, next) => {
    console.log(`[req] ${req.method} ${req.originalUrl}`);
    next();
});

app.use("/api", quickTradeRouter);

app.get("/healthz", async (_req, res) => {
    let dbHealthy = false;
    try {
        const result = await pool.query("SELECT 1;");
        dbHealthy = Boolean(result.rowCount);
    } catch (error) {
        console.warn(`[healthz] database check failed: ${(error as Error).message ?? error}`);
        dbHealthy = false;
    }

    const snapshot = getHealthSnapshot();
    const healthy = dbHealthy && snapshot.ws && snapshot.cache;
    res.status(healthy ? 200 : 503).json({ db: dbHealthy, ws: snapshot.ws, cache: snapshot.cache, symbols: snapshot.symbols });
});

app.get("/healthz/details", async (_req, res) => {
    let hasDb = false;
    try {
        const result = await pool.query("SELECT 1;");
        hasDb = Boolean(result.rowCount);
    } catch (error) {
        console.warn(`[healthz] details database check failed: ${(error as Error).message ?? error}`);
        hasDb = false;
    }

    const snapshot = getHealthSnapshot();
    const backfill = getBackfillSnapshot();

    res.status(200).json({
        hasDb,
        hasWs: snapshot.ws,
        backfill,
        symbols: configuredSymbols,
    });
});

const httpServer = createServer(app);

// --- WebSocket szerver (real-time broadcast a kliensnek) ---
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
const clients = new Set<WebSocket>();

const broadcast = (data: any) => {
    const message = JSON.stringify(data);
    clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(message);
        }
    });
};

wss.on("connection", (ws) => {
    clients.add(ws);
    if (shouldLogRequests) {
        console.warn("WebSocket client connected");
    }
    ws.on("close", () => {
        clients.delete(ws);
        if (shouldLogRequests) {
            console.warn("WebSocket client disconnected");
        }
    });
    ws.send(JSON.stringify({ type: "connection", status: "connected" }));
});

// --- Indítási folyamat ---
(async () => {
    const PORT = Number(process.env.PORT || 5000);

    try {
        await loadAccountSnapshotFromDisk();
    } catch (snapshotError) {
        console.warn(
            `[startup] failed to load account snapshot: ${(snapshotError as Error).message ?? snapshotError}`,
        );
    }

    try {
        await ensureSchema(pool);
    } catch (schemaError) {
        console.error("[ensureSchema] unexpected error", schemaError);
    }

    const migrationsFolder = path.resolve(fileURLToPath(new URL("../drizzle", import.meta.url)));

    if (shouldRunMigrations) {
        try {
            await migrate(db, { migrationsFolder });
            log("database migrations complete", "migrator");
        } catch (migrationError) {
            console.error("[startup] database migration failed", migrationError);
            if (migrationsRequired) {
                process.exit(1);
            }
        }
    } else {
        console.info("[startup] migrations disabled by configuration. Running autoheal only.");
    }

    try {
        await runAutoheal();
    } catch (autohealError) {
        const message = (autohealError as Error).message ?? autohealError;
        if (migrationsRequired) {
            console.error(`[startup] autoheal failed: ${message}`, autohealError);
            process.exit(1);
        } else {
            console.warn(`[startup] autoheal failed: ${message}`);
        }
    }

    const shouldTriggerBackfill = BACKFILL_ON_START && FUTURES && configuredSymbols.length > 0;
    if (shouldTriggerBackfill) {
        console.info(
            `[backfill] scheduling background backfill for ${configuredSymbols.length} symbols × ${BackfillTimeframes.length} timeframes (min ${BACKFILL_MIN_CANDLES})`,
        );
        void (async () => {
            try {
                await runFuturesBackfill();
            } catch (backfillError) {
                console.warn("[backfill] Startup backfill encountered an error", backfillError);
            }
        })();
    } else {
        if (!BACKFILL_ON_START) {
            console.info("[backfill] BACKFILL_ON_START is false. Skipping startup backfill.");
        } else if (!FUTURES) {
            console.info("[backfill] FUTURES flag disabled. Skipping startup backfill.");
        } else if (configuredSymbols.length === 0) {
            console.warn("[backfill] Skipping startup backfill because SYMBOL_LIST is empty.");
        }
    }

    const futuresSymbols = configuredSymbols;
    initializeMetrics(futuresSymbols, DEFAULT_TIMEFRAMES);

    const futuresEnabled = FUTURES;
    if (futuresEnabled) {
        if (futuresSymbols.length === 0) {
            console.warn("[live] SYMBOL_LIST is empty. Skipping futures live stream startup.");
            markCacheReady(true);
            markWsStatus("disabled");
            markSymbolsConfigured(false);
        } else {
            markSymbolsConfigured(true);
            let cacheReady = false;
            try {
                const bootstrap = await bootstrapMarketCaches(futuresSymbols, BackfillTimeframes);
                const totalPrimed = Object.values(bootstrap.prevClosePrimed).reduce(
                    (sum, value) => sum + (Number.isFinite(value) ? Number(value) : 0),
                    0,
                );
                console.info(
                    `[bootstrap] prevClose primed=${totalPrimed} lastPrice primed=${bootstrap.lastPricePrimed} yearly aggregated=${bootstrap.yearlyAggregates}`,
                );
                cacheReady = bootstrap.ready;
            } catch (cacheError) {
                cacheReady = false;
                console.warn(
                    `[bootstrap] cache priming failed: ${(cacheError as Error).message ?? cacheError}`,
                );
            }

            markCacheReady(cacheReady);
            startLiveFuturesStream();
        }
    } else {
        console.info("[live] FUTURES flag is false. Skipping futures live stream startup.");
        markCacheReady(true);
        markWsStatus("disabled");
    }

    // Broker kiválasztás (alapértelmezetten paper mód)
    const usePaper = (process.env.PAPER_TRADING ?? "true") !== "false";
    let broker: Broker;
    if (usePaper) {
        broker = new PaperBroker();
    } else {
        // Csak akkor importáljuk a real brokert, ha tényleg kell
        const { RealBinanceBroker } = await import("./real/RealBinanceBroker");
        broker = new RealBinanceBroker();
    }

    configureOrderService(broker);

    // Szervizek
    const binanceService = new BinanceService();
    const telegramService = new TelegramService();
    const indicatorService = new IndicatorService();

    // Párlisták inicializálása + price stream indítása → broadcast + ár-cache
    await binanceService.initializeTradingPairs();
    binanceService.startPriceStreams((data) => {
        // data: { symbol, price, ... }
        if (data?.symbol && data?.price) {
            const px = Number(data.price);
            if (!Number.isNaN(px)) setLastPrice(data.symbol, px);
        }
        broadcast({ type: "price_update", data });
    });

    // REST route-ok regisztrálása (körimport nélkül, függőségek átadása)
    registerRoutes(app, {
        broker,
        binanceService,
        telegramService,
        indicatorService,
        broadcast,
    });

    app.use(errorHandler);

    // Vite dev/production kiszolgálás
    if (app.get("env") === "development") {
        await setupVite(app, httpServer);
    } else {
        serveStatic(app);
    }

    // Listen
    httpServer.listen(
        {
            port: PORT,
            host: "0.0.0.0",
            reusePort: true,
        },
        () => {
            log(`serving on port ${PORT}`);
        },
    );
})().catch((err) => {
    console.error("Fatal startup error:", err);
    process.exit(1);
});
