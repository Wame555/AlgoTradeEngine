// server/routes.ts
import type { Express } from "express";
import type { Broker } from "./broker/types";

import { storage } from "./storage";
import { db } from "./db";
import { eq } from "drizzle-orm";

import { paperAccounts } from "@shared/schemaPaper";
import {
    insertUserSettingsSchema,
    insertIndicatorConfigSchema,
    insertPositionSchema,
} from "@shared/schema";

import type { BinanceService } from "./services/binanceService";
import type { TelegramService } from "./services/telegramService";
import type { IndicatorService } from "./services/indicatorService";

type Deps = {
    broker: Broker;
    binanceService: BinanceService;
    telegramService: TelegramService;
    indicatorService: IndicatorService;
    broadcast: (data: any) => void;
};

export function registerRoutes(app: Express, deps: Deps): void {
    const { broker, binanceService, telegramService, indicatorService, broadcast } = deps;

    // ----------------------------
    // Account (paper trading) API
    // ----------------------------
    app.get("/api/account", async (_req, res) => {
        try {
            const acc = await broker.account();
            res.json(acc);
        } catch (e) {
            console.error("GET /api/account error:", e);
            res.status(500).json({ message: "Failed to fetch account" });
        }
    });

    app.post("/api/account/reset", async (_req, res) => {
        try {
            // reset balance + pozíciók törlése
            await db.delete(paperAccounts);
            await db.insert(paperAccounts).values({ balance: "10000" });
            // ha külön táblád van poziknak a paper réteghez, ott is resetelj
            res.json({ ok: true });
        } catch (e) {
            console.error("POST /api/account/reset error:", e);
            res.status(500).json({ message: "Failed to reset account" });
        }
    });

    app.post("/api/account/update", async (req, res) => {
        try {
            const { balance, feeMakerBps, feeTakerBps, slippageBps, latencyMs, leverageMax } =
                req.body ?? {};
            const rows = await db.select().from(paperAccounts).limit(1);
            if (!rows.length) {
                await db.insert(paperAccounts).values({});
            }
            await db.update(paperAccounts).set({
                ...(balance != null ? { balance } : {}),
                ...(feeMakerBps != null ? { feeMakerBps } : {}),
                ...(feeTakerBps != null ? { feeTakerBps } : {}),
                ...(slippageBps != null ? { slippageBps } : {}),
                ...(latencyMs != null ? { latencyMs } : {}),
                ...(leverageMax != null ? { leverageMax } : {}),
            });
            res.json({ ok: true });
        } catch (e) {
            console.error("POST /api/account/update error:", e);
            res.status(500).json({ message: "Failed to update account" });
        }
    });

    // -------------
    // Pairs / Market
    // -------------
    app.get("/api/pairs", async (_req, res) => {
        try {
            const pairs = await storage.getAllTradingPairs();
            res.json(pairs);
        } catch (e) {
            console.error("GET /api/pairs error:", e);
            res.status(500).json({ message: "Failed to fetch trading pairs" });
        }
    });

    app.get("/api/market-data", async (req, res) => {
        try {
            const symbols = req.query.symbols ? String(req.query.symbols).split(",") : undefined;
            const data = await storage.getMarketData(symbols);
            res.json(data);
        } catch (e) {
            console.error("GET /api/market-data error:", e);
            res.status(500).json({ message: "Failed to fetch market data" });
        }
    });

    // --------
    // Settings
    // --------
    app.get("/api/settings/:userId", async (req, res) => {
        try {
            const { userId } = req.params;
            const settings = await storage.getUserSettings(userId);
            res.json(settings);
        } catch (e) {
            console.error("GET /api/settings/:userId error:", e);
            res.status(500).json({ message: "Failed to fetch settings" });
        }
    });

    app.post("/api/settings", async (req, res) => {
        try {
            const settings = insertUserSettingsSchema.parse(req.body);
            const result = await storage.upsertUserSettings(settings);

            if (settings.binanceApiKey && settings.binanceApiSecret) {
                binanceService.updateCredentials(
                    settings.binanceApiKey,
                    settings.binanceApiSecret,
                    settings.isTestnet ?? false
                );
            }
            if (settings.telegramBotToken && settings.telegramChatId) {
                telegramService.updateCredentials(settings.telegramBotToken, settings.telegramChatId);
            }

            res.json(result);
        } catch (e) {
            console.error("POST /api/settings error:", e);
            res.status(500).json({ message: "Failed to save settings" });
        }
    });

    // ----------
    // Positions
    // ----------
    app.get("/api/positions/:userId", async (req, res) => {
        try {
            const { userId } = req.params;
            const positions = await storage.getUserPositions(userId);
            res.json(positions);
        } catch (e) {
            console.error("GET /api/positions/:userId error:", e);
            res.status(500).json({ message: "Failed to fetch positions" });
        }
    });

    app.post("/api/positions", async (req, res) => {
        try {
            const position = insertPositionSchema.parse(req.body);

            // paper/live egységesen a brokeren keresztül
            const side = position.side === "LONG" ? "BUY" : "SELL";
            const qty = parseFloat(position.size);
            const order = await broker.placeOrder({
                symbol: position.symbol,
                side,
                type: "MARKET",
                qty,
            });

            if (!order) {
                return res.status(400).json({ message: "Failed to execute trade" });
            }

            // entryPrice a legelső fill ára
            const entry = order.fills?.[0]?.price ?? position.entryPrice;
            position.orderId = order.orderId;
            position.entryPrice = entry;

            const result = await storage.createPosition(position);

            await telegramService.sendTradeNotification({
                action: "opened",
                symbol: position.symbol,
                side: position.side,
                size: position.size,
                price: position.entryPrice,
                stopLoss: position.stopLoss ?? undefined,
                takeProfit: position.takeProfit ?? undefined,
            });

            broadcast({ type: "position_opened", data: result });
            res.json(result);
        } catch (e) {
            console.error("POST /api/positions error:", e);
            res.status(500).json({ message: "Failed to create position" });
        }
    });

    app.put("/api/positions/:id", async (req, res) => {
        try {
            const { id } = req.params;
            const updates = req.body;
            const result = await storage.updatePosition(id, updates);

            broadcast({ type: "position_updated", data: result });
            res.json(result);
        } catch (e) {
            console.error("PUT /api/positions/:id error:", e);
            res.status(500).json({ message: "Failed to update position" });
        }
    });

    app.delete("/api/positions/:id", async (req, res) => {
        try {
            const { id } = req.params;
            const position = await storage.closePosition(id);

            // ha valódi order lenne, itt lehetne cancel/close a brókeren
            // (paper módban nincs külön futó nyitott order)
            broadcast({ type: "position_closed", data: position });
            res.json(position);
        } catch (e) {
            console.error("DELETE /api/positions/:id error:", e);
            res.status(500).json({ message: "Failed to close position" });
        }
    });

    app.post("/api/positions/:userId/close-all", async (req, res) => {
        try {
            const { userId } = req.params;
            await storage.closeAllUserPositions(userId);

            await telegramService.sendNotification("🛑 All positions have been closed");
            broadcast({ type: "all_positions_closed", userId });
            res.json({ message: "All positions closed" });
        } catch (e) {
            console.error("POST /api/positions/:userId/close-all error:", e);
            res.status(500).json({ message: "Failed to close all positions" });
        }
    });

    // -----------
    // Indicators
    // -----------
    app.get("/api/indicators/:userId", async (req, res) => {
        try {
            const { userId } = req.params;
            const indicators = await storage.getUserIndicators(userId);
            res.json(indicators);
        } catch (e) {
            console.error("GET /api/indicators/:userId error:", e);
            res.status(500).json({ message: "Failed to fetch indicators" });
        }
    });

    app.post("/api/indicators", async (req, res) => {
        try {
            const indicator = insertIndicatorConfigSchema.parse(req.body);
            const result = await storage.createIndicatorConfig(indicator);
            res.json(result);
        } catch (e) {
            console.error("POST /api/indicators error:", e);
            res.status(500).json({ message: "Failed to create indicator" });
        }
    });

    app.put("/api/indicators/:id", async (req, res) => {
        try {
            const { id } = req.params;
            const updates = req.body;
            const result = await storage.updateIndicatorConfig(id, updates);
            res.json(result);
        } catch (e) {
            console.error("PUT /api/indicators/:id error:", e);
            res.status(500).json({ message: "Failed to update indicator" });
        }
    });

    app.delete("/api/indicators/:id", async (req, res) => {
        try {
            const { id } = req.params;
            await storage.deleteIndicatorConfig(id);
            res.json({ message: "Indicator deleted" });
        } catch (e) {
            console.error("DELETE /api/indicators/:id error:", e);
            res.status(500).json({ message: "Failed to delete indicator" });
        }
    });

    // -------
    // Signals
    // -------
    app.get("/api/signals", async (req, res) => {
        try {
            const limit = req.query.limit ? parseInt(String(req.query.limit)) : 50;
            const signals = await storage.getRecentSignals(limit);
            res.json(signals);
        } catch (e) {
            console.error("GET /api/signals error:", e);
            res.status(500).json({ message: "Failed to fetch signals" });
        }
    });

    app.get("/api/signals/:symbol", async (req, res) => {
        try {
            const { symbol } = req.params;
            const limit = req.query.limit ? parseInt(String(req.query.limit)) : 20;
            const signals = await storage.getSignalsBySymbol(symbol, limit);
            res.json(signals);
        } catch (e) {
            console.error("GET /api/signals/:symbol error:", e);
            res.status(500).json({ message: "Failed to fetch signals" });
        }
    });

    // -----------------
    // Pair timeframes
    // -----------------
    app.get("/api/pair-timeframes/:userId", async (req, res) => {
        try {
            const { userId } = req.params;
            const timeframes = await storage.getUserPairTimeframes(userId);
            res.json(timeframes);
        } catch (e) {
            console.error("GET /api/pair-timeframes/:userId error:", e);
            res.status(500).json({ message: "Failed to fetch pair timeframes" });
        }
    });

    app.post("/api/pair-timeframes", async (req, res) => {
        try {
            const timeframes = req.body;
            const result = await storage.upsertPairTimeframes(timeframes);
            res.json(result);
        } catch (e) {
            console.error("POST /api/pair-timeframes error:", e);
            res.status(500).json({ message: "Failed to save pair timeframes" });
        }
    });

    // --------------
    // Telegram test
    // --------------
    app.post("/api/telegram/test", async (req, res) => {
        try {
            const { botToken, chatId } = req.body ?? {};
            const success = await telegramService.testConnection(botToken, chatId);
            res.json({ success });
        } catch (e) {
            console.error("POST /api/telegram/test error:", e);
            res.status(500).json({ message: "Failed to test telegram connection" });
        }
    });
}
