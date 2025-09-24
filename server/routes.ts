import type { Express } from "express";
import type { Broker } from "./broker/types";
import { z, ZodError } from "zod";

import { storage } from "./storage";
import { db } from "./db";
import { and, desc, eq } from "drizzle-orm";

import { paperAccounts } from "@shared/schemaPaper";
import {
  insertUserSettingsSchema,
  insertPositionSchema,
  closedPositions,
} from "@shared/schema";
import { calculateQuantityFromUsd, QuantityValidationError } from "@shared/tradingUtils";

import type { BinanceService } from "./services/binanceService";
import type { TelegramService } from "./services/telegramService";
import type { IndicatorService } from "./services/indicatorService";
import { getLastPrice } from "./paper/PriceFeed";
import { logError } from "./utils/logger";

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

const indicatorConfigSchema = z.object({
  name: z.string().min(1, "Indicator name is required"),
  params: z.union([z.record(z.any()), z.string()]).default({}),
  enabled: z.boolean().optional().default(false),
});

const indicatorConfigRequestSchema = z.object({
  configs: z.array(indicatorConfigSchema),
});

const quickTradeSchema = insertPositionSchema
  .extend({
    size: insertPositionSchema.shape.size.optional(),
    amountUsd: z.union([z.string(), z.number()]).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.size && !data.amountUsd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either position size or amount in USDT",
        path: ["size"],
      });
    }
  });

const pairTimeframeRequestSchema = z.object({
  symbol: z.string().min(1, "Symbol is required"),
  tfs: z.array(z.string().min(1)).max(12),
});

const accountPatchSchema = z
  .object({
    initialBalance: z.union([z.number(), z.string()]).optional(),
    feesMultiplier: z.union([z.number(), z.string()]).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.initialBalance && !value.feesMultiplier) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide at least one field to patch",
      });
    }
  });

const manualCloseSchema = z.object({
  symbol: z.string().min(1),
  side: z.enum(["LONG", "SHORT"]),
  entry_ts: z.coerce.date(),
  exit_ts: z.coerce.date(),
  entry_px: z.coerce.number().positive(),
  exit_px: z.coerce.number().positive(),
  qty: z.coerce.number().positive(),
  fee: z.coerce.number().nonnegative().default(0),
});

function respondWithError(res: any, scope: string, error: unknown, fallback: string) {
  if (error instanceof ZodError) {
    const firstError = error.errors[0]?.message ?? "Invalid request";
    logError(`${scope} validation`, error).catch(() => {});
    return res.status(400).json({ message: firstError });
  }
  if (error instanceof QuantityValidationError) {
    logError(`${scope} validation`, error).catch(() => {});
    return res.status(400).json({ message: error.message });
  }
  logError(scope, error).catch(() => {});
  return res.status(500).json({ message: fallback });
}

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
      EMA: indicatorService.calculateMA(closes, 20, "EMA"),
      BollingerBands: indicatorService.calculateBollingerBands(closes),
    } as const;

    const weights = {
      RSI: 0.3,
      MACD: 0.3,
      EMA: 0.2,
      BollingerBands: 0.2,
    } as const;

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
    return ["1h"];
  };

  app.get("/api/session", async (_req, res) => {
    try {
      const sessionData = await ensureDefaultUser();
      res.json(sessionData);
    } catch (error) {
      respondWithError(res, "GET /api/session", error, "Failed to initialise session");
    }
  });

  app.get("/api/account", async (_req, res) => {
    try {
      const acc = await broker.account();
      res.json(acc);
    } catch (error) {
      respondWithError(res, "GET /api/account", error, "Failed to fetch account");
    }
  });

  app.post("/api/account/reset", async (_req, res) => {
    try {
      await db.delete(paperAccounts);
      await db.insert(paperAccounts).values({ balance: "10000" });
      await storage.deleteAllClosedPositions();
      await storage.setAllIndicatorConfigsEnabled(false);
      res.json({ ok: true });
    } catch (error) {
      respondWithError(res, "POST /api/account/reset", error, "Failed to reset account");
    }
  });

  app.post("/api/account/update", async (req, res) => {
    try {
      const { balance, feeMakerBps, feeTakerBps, slippageBps, latencyMs, leverageMax } = req.body ?? {};
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
    } catch (error) {
      respondWithError(res, "POST /api/account/update", error, "Failed to update account");
    }
  });

  app.post("/api/account/patch", async (req, res) => {
    try {
      const payload = accountPatchSchema.parse(req.body ?? {});
      const [account] = await db.select().from(paperAccounts).limit(1);
      if (!account) {
        await db.insert(paperAccounts).values({});
      }
      const updates: Partial<typeof paperAccounts.$inferInsert> = {};

      if (payload.initialBalance != null) {
        const balance = Number(payload.initialBalance);
        if (!Number.isFinite(balance) || balance <= 0) {
          return res.status(400).json({ message: "initialBalance must be a positive number" });
        }
        updates.balance = balance.toString();
      }

      if (payload.feesMultiplier != null) {
        const multiplier = Number(payload.feesMultiplier);
        if (!Number.isFinite(multiplier) || multiplier <= 0) {
          return res.status(400).json({ message: "feesMultiplier must be greater than zero" });
        }
        const row = account ?? (await db.select().from(paperAccounts).limit(1))[0];
        const maker = Number(row?.feeMakerBps ?? 1) * multiplier;
        const taker = Number(row?.feeTakerBps ?? 5) * multiplier;
        updates.feeMakerBps = Math.max(0, Math.round(maker));
        updates.feeTakerBps = Math.max(0, Math.round(taker));
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "Nothing to patch" });
      }

      await db.update(paperAccounts).set(updates);
      res.json({ ok: true });
    } catch (error) {
      respondWithError(res, "POST /api/account/patch", error, "Failed to apply account patch");
    }
  });

  app.get("/api/pairs", async (_req, res) => {
    try {
      const pairs = await storage.getAllTradingPairs();
      res.json(pairs);
    } catch (error) {
      respondWithError(res, "GET /api/pairs", error, "Failed to fetch trading pairs");
    }
  });

  app.get("/api/market-data", async (req, res) => {
    try {
      const symbols = req.query.symbols ? String(req.query.symbols).split(",") : undefined;
      const data = await storage.getMarketData(symbols);
      res.json(data);
    } catch (error) {
      respondWithError(res, "GET /api/market-data", error, "Failed to fetch market data");
    }
  });

  app.get("/api/settings/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const settings = await storage.getUserSettings(userId);
      res.json(settings);
    } catch (error) {
      respondWithError(res, "GET /api/settings/:userId", error, "Failed to fetch settings");
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
          settings.isTestnet ?? false,
        );
      }
      if (settings.telegramBotToken && settings.telegramChatId) {
        telegramService.updateCredentials(settings.telegramBotToken, settings.telegramChatId);
      }

      res.json(result);
    } catch (error) {
      respondWithError(res, "POST /api/settings", error, "Failed to save settings");
    }
  });

  app.get("/api/positions/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const positions = await storage.getUserPositions(userId);
      res.json(positions);
    } catch (error) {
      respondWithError(res, "GET /api/positions/:userId", error, "Failed to fetch positions");
    }
  });

  app.post("/api/positions", async (req, res) => {
    try {
      const payload = quickTradeSchema.parse(req.body ?? {});
      const request = { ...payload } as any;

      if (!request.size && request.amountUsd) {
        const amountUsd = Number(request.amountUsd);
        const lastPrice = getLastPrice(request.symbol);
        if (!lastPrice) {
          return res.status(400).json({ message: "No market price available for the selected symbol" });
        }

        const tradingPair = await storage.getTradingPair(request.symbol);
        const filters = await binanceService.getSymbolFilters(request.symbol);
        const stepSize = filters?.stepSize ?? (tradingPair?.stepSize ? Number(tradingPair.stepSize) : undefined);
        const minQty = filters?.minQty ?? (tradingPair?.minQty ? Number(tradingPair.minQty) : undefined);
        const minNotional =
          filters?.minNotional ?? (tradingPair?.minNotional ? Number(tradingPair.minNotional) : undefined);

        const quantityResult = calculateQuantityFromUsd(amountUsd, lastPrice, {
          stepSize,
          minQty,
          minNotional,
        });
        request.size = quantityResult.quantity.toFixed(8);
      }

      if (!request.size) {
        return res.status(400).json({ message: "Position size could not be determined" });
      }

      const position = insertPositionSchema.parse({
        ...request,
        entryPrice: request.entryPrice ?? "0",
      });

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
    } catch (error) {
      respondWithError(res, "POST /api/positions", error, "Failed to create position");
    }
  });

  app.put("/api/positions/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      const result = await storage.updatePosition(id, updates);

      broadcast({ type: "position_updated", data: result });
      res.json(result);
    } catch (error) {
      respondWithError(res, "PUT /api/positions/:id", error, "Failed to update position");
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
      const pnl =
        position.side === "LONG"
          ? (closePrice - entryPrice) * size
          : (entryPrice - closePrice) * size;

      const closedPosition = await storage.closePosition(id, {
        closePrice: closePrice.toFixed(8),
        pnl: pnl.toFixed(8),
      });

      await storage.insertClosedPosition({
        symbol: position.symbol,
        side: position.side,
        entryTs: position.openedAt ?? new Date(),
        exitTs: new Date(),
        entryPx: position.entryPrice,
        exitPx: closePrice.toString(),
        qty: position.size,
        fee: "0",
      });

      broadcast({ type: "position_closed", data: closedPosition });
      res.json(closedPosition);
    } catch (error) {
      respondWithError(res, "DELETE /api/positions/:id", error, "Failed to close position");
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
        const pnl =
          position.side === "LONG"
            ? (closePrice - entryPrice) * size
            : (entryPrice - closePrice) * size;

        storage
          .insertClosedPosition({
            symbol: position.symbol,
            side: position.side,
            entryTs: position.openedAt ?? new Date(),
            exitTs: new Date(),
            entryPx: position.entryPrice,
            exitPx: closePrice.toString(),
            qty: position.size,
            fee: "0",
          })
          .catch((err) => logError("closeAllUserPositions insertClosedPosition", err));

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
    } catch (error) {
      respondWithError(res, "POST /api/positions/:userId/close-all", error, "Failed to close all positions");
    }
  });

  app.post("/api/trades/close", async (req, res) => {
    try {
      const body = manualCloseSchema.parse(req.body ?? {});
      const result = await storage.insertClosedPosition({
        symbol: body.symbol,
        side: body.side,
        entryTs: body.entry_ts,
        exitTs: body.exit_ts,
        entryPx: body.entry_px.toString(),
        exitPx: body.exit_px.toString(),
        qty: body.qty.toString(),
        fee: body.fee.toString(),
      });
      res.json(result);
    } catch (error) {
      respondWithError(res, "POST /api/trades/close", error, "Failed to record closed trade");
    }
  });

  app.get("/api/stats/summary", async (_req, res) => {
    try {
      const rows = await db.select().from(closedPositions);

      const totalTrades = rows.length;
      const totalPnl = rows.reduce((sum, row) => sum + Number(row.pnlUsd ?? 0), 0);
      const winningTrades = rows.filter((row) => Number(row.pnlUsd ?? 0) > 0).length;
      const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

      let rewardSum = 0;
      let rewardCount = 0;
      for (const row of rows) {
        const entryPx = Number(row.entryPx ?? 0);
        const exitPx = Number(row.exitPx ?? 0);
        if (!Number.isFinite(entryPx) || entryPx === 0) {
          continue;
        }
        const delta = row.side === "LONG" ? exitPx - entryPx : entryPx - exitPx;
        rewardSum += delta / entryPx;
        rewardCount += 1;
      }
      const avgReward = rewardCount > 0 ? rewardSum / rewardCount : 0;

      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const last30dPnl = rows
        .filter((row) => row.exitTs && new Date(row.exitTs) >= cutoff)
        .reduce((sum, row) => sum + Number(row.pnlUsd ?? 0), 0);

      res.json({
        totalTrades,
        winRate,
        avgRR: avgReward,
        totalPnl,
        last30dPnl,
      });
    } catch (error) {
      respondWithError(res, "GET /api/stats/summary", error, "Failed to fetch statistics summary");
    }
  });

  app.get("/api/indicator-configs", async (_req, res) => {
    try {
      const configs = await storage.getIndicatorConfigs();
      res.json(configs);
    } catch (error) {
      respondWithError(res, "GET /api/indicator-configs", error, "Failed to fetch indicator configurations");
    }
  });

  app.post("/api/indicator-configs", async (req, res) => {
    try {
      const { configs } = indicatorConfigRequestSchema.parse(req.body ?? {});
      const normalised = [] as Array<{ name: string; params: Record<string, unknown>; enabled: boolean }>;

      for (const config of configs) {
        let params: Record<string, unknown> = {};
        if (typeof config.params === "string") {
          try {
            params = config.params ? JSON.parse(config.params) : {};
          } catch (parseError) {
            return res.status(400).json({ message: `Invalid params JSON for ${config.name}` });
          }
        } else {
          params = (config.params as Record<string, unknown>) ?? {};
        }
        normalised.push({
          name: config.name,
          params,
          enabled: config.enabled ?? false,
        });
      }

      const result = await storage.upsertIndicatorConfigs(normalised as any);
      res.json(result);
    } catch (error) {
      respondWithError(res, "POST /api/indicator-configs", error, "Failed to save indicator configurations");
    }
  });

  app.get("/api/signals", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;

      const [pairs, pairTimeframesRows] = await Promise.all([
        storage.getAllTradingPairs(),
        storage.getPairTimeframes(),
      ]);

      const timeframeMap = new Map<string, string[]>();
      pairTimeframesRows.forEach((row) => {
        const list = timeframeMap.get(row.symbol) ?? [];
        list.push(row.timeframe);
        timeframeMap.set(row.symbol, list);
      });

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
    } catch (error) {
      respondWithError(res, "GET /api/signals", error, "Failed to fetch signals");
    }
  });

  app.get("/api/signals/:symbol", async (req, res) => {
    try {
      const { symbol } = req.params;
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 20;

      const pairTimeframesRows = await storage.getPairTimeframes(symbol);
      const timeframeMap = new Map<string, string[]>();
      pairTimeframesRows.forEach((row) => {
        const list = timeframeMap.get(row.symbol) ?? [];
        list.push(row.timeframe);
        timeframeMap.set(row.symbol, list);
      });

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
    } catch (error) {
      respondWithError(res, "GET /api/signals/:symbol", error, "Failed to fetch signals");
    }
  });

  app.get("/api/pairs/timeframes", async (req, res) => {
    try {
      const symbol = req.query.symbol ? String(req.query.symbol) : undefined;
      const rows = await storage.getPairTimeframes(symbol);
      res.json(rows);
    } catch (error) {
      respondWithError(res, "GET /api/pairs/timeframes", error, "Failed to fetch pair timeframes");
    }
  });

  app.post("/api/pairs/timeframes", async (req, res) => {
    try {
      const payload = pairTimeframeRequestSchema.parse(req.body ?? {});
      const rows = await storage.replacePairTimeframes(payload.symbol, payload.tfs);
      res.json(rows);
    } catch (error) {
      respondWithError(res, "POST /api/pairs/timeframes", error, "Failed to save pair timeframes");
    }
  });

  app.post("/api/telegram/test", async (req, res) => {
    try {
      const { botToken, chatId } = req.body ?? {};
      const success = await telegramService.testConnection(botToken, chatId);
      res.json({ success });
    } catch (error) {
      respondWithError(res, "POST /api/telegram/test", error, "Failed to test telegram connection");
    }
  });
}
