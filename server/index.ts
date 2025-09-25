// server/index.ts
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { setupVite, serveStatic, log } from "./vite";
import { registerRoutes } from "./routes";

import { PaperBroker } from "./paper/PaperBroker";
import type { Broker } from "./broker/types";

import { BinanceService } from "./services/binanceService";
import { TelegramService } from "./services/telegramService";
import { IndicatorService } from "./services/indicatorService";
import { setLastPrice } from "./paper/PriceFeed";
import { db, pool } from "./db";
import { ensureSchema } from "./db/guards";
import { runFuturesBackfill } from "./services/backfill";

const shouldLogRequests = (process.env.EXPRESS_DEBUG ?? "false") === "true";
const runMigrationsOnStart = (process.env.RUN_MIGRATIONS_ON_START ?? "false").toLowerCase() === "true";

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

const globalErrorHandler: ErrorRequestHandler = (err, req, res, _next) => {
    const message = err instanceof Error && err.message ? err.message : "Internal Server Error";
    const payload: Record<string, unknown> = { error: true, message };

    if (err && typeof err === "object" && "details" in err && err.details != null) {
        payload.details = (err as { details: unknown }).details;
    }

    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
    res.status(500).json(payload);
};

// --- Express app + HTTP szerver ---
const app = express();
if (shouldLogRequests) {
    app.use(requestLogger);
}
app.use(express.json());

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
        await ensureSchema(pool);
    } catch (schemaError) {
        console.error("[ensureSchema] unexpected error", schemaError);
    }

    const migrationsFolder = path.resolve(fileURLToPath(new URL("../drizzle", import.meta.url)));

    if (runMigrationsOnStart) {
        try {
            await migrate(db, { migrationsFolder });
            log("database migrations complete", "migrator");
        } catch (migrationError) {
            console.error("Database migration failed:", migrationError);
            process.exit(1);
        }

        try {
            await runFuturesBackfill();
        } catch (backfillError) {
            console.warn("[backfill] Startup backfill encountered an error", backfillError);
        }
    } else {
        console.info("[startup] RUN_MIGRATIONS_ON_START flag is false. Skipping migrations/backfill.");
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

    app.use(globalErrorHandler);

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
