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
import { getLastPrice } from "./paper/PriceFeed";

const DEFAULT_SESSION_USERNAME = process.env.DEFAULT_USER ?? "demo";
const DEFAULT_SESSION_PASSWORD = process.env.DEFAULT_USER_PASSWORD ?? "demo";

async function ensureDefaultUser() {
    let user = await storage.getUserByUsername(DEFAULT_SESSION_USERNAME);
    if (!user) {
        user = await storage.createUser({
            username: DEFAULT_SESSION_USERNAME,
            password: DEFAULT_SESSION_PASSWORD,
        });
    }

    let settings = await storage.getUserSettings(user.id);
    if (!settings) {
        settings = await storage.upsertUserSettings({
            userId: user.id,
            isTestnet: true,
            defaultLeverage: 1,
            riskPercent: 2,
        });
    }

    return { user, settings };
}

type Deps = {
    broker: Broker;
    binanceService: BinanceService;
    telegramService: TelegramService;
    indicatorService: IndicatorService;
    broadcast: (data: any) => void;
};

export function registerRoutes(app: Express, deps: Deps): void {
    const { broker, binanceService, telegramService, indicatorService, broadcast } = deps;

    const calculateSignalForPair = async (symbol: string, timeframe: string) => {
        const klines = await binanceService.getKlines(symbol, timeframe, 200);
        if (!Array.isArray(klines) || klines.length === 0) {
            return null;
        }

        const closes = klines
            .map((kline) => parseFloat(kline[4]))
            .filter((price) => Number.isFinite(price));

        if (closes.length < 30) {
            return null;
        }

        const indicators = {
            RSI: indicatorService.calculateRSI(closes),
            MACD: indicatorService.calculateMACD(closes),
            EMA: indicatorService.calculateMA(closes, 20, 'EMA'),
            BollingerBands: indicatorService.calculateBollingerBands(closes),
        };

        const weights = {
            RSI: 0.3,
            MACD: 0.3,
            EMA: 0.2,
            BollingerBands: 0.2,
        };

        const combined = indicatorService.combineSignals(indicators, weights);
        const lastKline = klines[klines.length - 1];
        const closePrice = closes[closes.length - 1];
        const closeTime = Number(lastKline?.[6]) || Date.now();

        return {
            id: `${symbol}-${timeframe}`,
            symbol,
            timeframe,
            signal: combined.signal,
            confidence: combined.confidence,
            indicators,
            price: closePrice.toFixed(8),
            createdAt: new Date(closeTime).toISOString(),
        };
    };

    const getTimeframesForSymbol = (timeframeMap: Map<string, string[]>, symbol: string) => {
        const configured = timeframeMap.get(symbol);
        if (configured && configured.length > 0) {
            return configured;
        }
        return ['1h'];
    };

    // ----------------
    // Session / Users
    // ----------------
    app.get("/api/session", async (_req, res) => {
        try {
            const sessionData = await ensureDefaultUser();
            res.json(sessionData);
        } catch (e) {
            console.error("GET /api/session error:", e);
            res.status(500).json({ message: "Failed to initialise session" });
        }
    });

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
            await db.delete(paperAccounts);
            await db.insert(paperAccounts).values({ balance: "10000" });
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

    app.get("/api/positions/:userId/stats", async (req, res) => {
        try {
            const { userId } = req.params;
            const stats = await storage.getUserPositionStats(userId);
            res.json(stats);
        } catch (e) {
            console.error("GET /api/positions/:userId/stats error:", e);
            res.status(500).json({ message: "Failed to fetch position statistics" });
        }
    });

    app.post("/api/positions", async (req, res) => {
        try {
            const position = insertPositionSchema.parse(req.body);

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

            const entryFill = order.fills?.[0]?.price;
            const entryPrice = entryFill != null ? entryFill.toString() : position.entryPrice;
            position.orderId = order.orderId;
            position.entryPrice = entryPrice;
            position.currentPrice = entryPrice;

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
            const position = await storage.getPositionById(id);
            if (!position) {
                return res.status(404).json({ message: "Position not found" });
            }

            const lastPrice = getLastPrice(position.symbol);
            const fallbackPrice = Number(position.currentPrice ?? position.entryPrice);
            const closePrice = lastPrice ?? fallbackPrice;
            const entryPrice = Number(position.entryPrice);
            const size = Number(position.size);
            const pnl = position.side === 'LONG'
                ? (closePrice - entryPrice) * size
                : (entryPrice - closePrice) * size;

            const closedPosition = await storage.closePosition(id, {
                closePrice: closePrice.toFixed(8),
                pnl: pnl.toFixed(8),
            });

            broadcast({ type: "position_closed", data: closedPosition });
            res.json(closedPosition);
        } catch (e) {
            console.error("DELETE /api/positions/:id error:", e);
            res.status(500).json({ message: "Failed to close position" });
        }
    });

    app.post("/api/positions/:userId/close-all", async (req, res) => {
        try {
            const { userId } = req.params;
            const closedPositions = await storage.closeAllUserPositions(userId, (position) => {
                const lastPrice = getLastPrice(position.symbol);
                const fallbackPrice = Number(position.currentPrice ?? position.entryPrice);
                const closePrice = lastPrice ?? fallbackPrice;
                const entryPrice = Number(position.entryPrice);
                const size = Number(position.size);
                const pnl = position.side === 'LONG'
                    ? (closePrice - entryPrice) * size
                    : (entryPrice - closePrice) * size;

                return {
                    closePrice: closePrice.toFixed(8),
                    pnl: pnl.toFixed(8),
                };
            });

            await telegramService.sendNotification("🛑 All positions have been closed");
            closedPositions.forEach((position) => {
                broadcast({ type: "position_closed", data: position });
            });
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
            const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
            const userId = req.query.userId ? String(req.query.userId) : undefined;

            const [pairs, pairTimeframes] = await Promise.all([
                storage.getAllTradingPairs(),
                userId ? storage.getUserPairTimeframes(userId) : Promise.resolve([]),
            ]);

            const timeframeMap = new Map<string, string[]>();
            for (const row of pairTimeframes) {
                const timeframes = Array.isArray(row.timeframes) ? row.timeframes : [];
                timeframeMap.set(row.symbol, timeframes);
            }

            const signals = [] as any[];

            outer: for (const pair of pairs) {
                for (const timeframe of getTimeframesForSymbol(timeframeMap, pair.symbol)) {
                    const signal = await calculateSignalForPair(pair.symbol, timeframe);
                    if (signal) {
                        signals.push(signal);
                        if (signals.length >= limit) {
                            break outer;
                        }
                    }
                }
            }

            res.json(signals);
        } catch (e) {
            console.error("GET /api/signals error:", e);
            res.status(500).json({ message: "Failed to fetch signals" });
        }
    });

    app.get("/api/signals/:symbol", async (req, res) => {
        try {
            const { symbol } = req.params;
            const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 20;
            const userId = req.query.userId ? String(req.query.userId) : undefined;

            const pairTimeframes = userId
                ? await storage.getUserPairTimeframes(userId)
                : [];
            const timeframeMap = new Map<string, string[]>();
            for (const row of pairTimeframes) {
                const timeframes = Array.isArray(row.timeframes) ? row.timeframes : [];
                timeframeMap.set(row.symbol, timeframes);
            }

            const signals = [] as any[];
            for (const timeframe of getTimeframesForSymbol(timeframeMap, symbol)) {
                const signal = await calculateSignalForPair(symbol, timeframe);
                if (signal) {
                    signals.push(signal);
                }
                if (signals.length >= limit) {
                    break;
                }
            }

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
