import type { Express, Response } from "express";
import type { Broker } from "./broker/types";
import type { DatabaseError } from "pg";
import { z, ZodError } from "zod";

import { storage } from "./storage";
import { db, pool } from "./db";
import { and, desc, eq } from "drizzle-orm";

import { paperAccounts } from "@shared/schemaPaper";
import {
  insertUserSettingsSchema,
  insertPositionSchema,
  closedPositions,
  indicatorConfigs,
  positions,
  userSettings,
  users,
  type Position,
  type User,
  type UserSettings,
} from "@shared/schema";
import { calculateQuantityFromUsd, QuantityValidationError } from "@shared/tradingUtils";

import type { BinanceService } from "./services/binanceService";
import type { TelegramService } from "./services/telegramService";
import type { IndicatorService } from "./services/indicatorService";
import { getLastPrice } from "./paper/PriceFeed";
import { logError } from "./utils/logger";
import { ensureUserSettingsGuard } from "./scripts/dbGuard";

const DEFAULT_SESSION_USERNAME = process.env.DEFAULT_USER ?? "demo";
const DEFAULT_SESSION_PASSWORD = process.env.DEFAULT_USER_PASSWORD ?? "demo";
const DEMO_USER_ID = "00000000-0000-0000-0000-000000000001";
const SESSION_TIMEOUT_MS = 5000;
const SESSION_TIMEOUT_MESSAGE = `Session initialisation timed out after ${SESSION_TIMEOUT_MS}ms`;

let userSettingsGuardPromise: Promise<void> | null = null;

type HealthIndexSpec =
  | {
      type: "index";
      name: string;
      table: string;
      columns: string[];
      unique?: boolean;
    }
  | {
      type: "constraint";
      name: string;
      table: string;
    };

const HEALTH_CHECK_REQUIREMENTS: HealthIndexSpec[] = [
  { type: "constraint", name: "user_settings_user_id_uniq", table: "user_settings" },
  { type: "index", name: "idx_closed_positions_symbol_time", table: "closed_positions", columns: ["symbol", "closed_at"] },
  { type: "index", name: "idx_closed_positions_user", table: "closed_positions", columns: ["user_id"] },
  { type: "index", name: "idx_indicator_configs_user_name", table: "indicator_configs", columns: ["user_id", "name"] },
  { type: "index", name: "pair_timeframes_symbol_timeframe_unique", table: "pair_timeframes", columns: ["symbol", "timeframe"], unique: true },
];

function runUserSettingsGuard(): Promise<void> {
  if (!userSettingsGuardPromise) {
    userSettingsGuardPromise = ensureUserSettingsGuard(pool).catch((error) => {
      console.error("[userSettingsGuard] failed to self-heal user_settings table", error);
      throw error;
    });
  }
  return userSettingsGuardPromise;
}

const userSettingsGuardBootstrap = runUserSettingsGuard();

const DEFAULT_USER_SETTINGS = {
  isTestnet: true,
  defaultLeverage: 1,
  riskPercent: 2,
  demoEnabled: true,
  defaultTpPct: "1.00",
  defaultSlPct: "0.50",
} as const;

async function ensureDemoUserRecord(): Promise<User> {
  return db.transaction(async (tx) => {
    const [existingDemoById] = await tx.select().from(users).where(eq(users.id, DEMO_USER_ID)).limit(1);
    const [existingByUsername] = await tx
      .select()
      .from(users)
      .where(eq(users.username, DEFAULT_SESSION_USERNAME))
      .limit(1);

    if (existingByUsername && existingByUsername.id !== DEMO_USER_ID) {
      const legacyId = existingByUsername.id;

      const [existingDemoSettings] = await tx
        .select({ id: userSettings.id })
        .from(userSettings)
        .where(eq(userSettings.userId, DEMO_USER_ID))
        .limit(1);

      const [legacySettings] = await tx
        .select({ id: userSettings.id })
        .from(userSettings)
        .where(eq(userSettings.userId, legacyId))
        .limit(1);

      if (legacySettings) {
        if (existingDemoSettings) {
          await tx.delete(userSettings).where(eq(userSettings.userId, legacyId));
        } else {
          await tx.update(userSettings).set({ userId: DEMO_USER_ID }).where(eq(userSettings.userId, legacyId));
        }
      }

      await tx.update(indicatorConfigs).set({ userId: DEMO_USER_ID }).where(eq(indicatorConfigs.userId, legacyId));
      await tx.update(positions).set({ userId: DEMO_USER_ID }).where(eq(positions.userId, legacyId));
      await tx.update(closedPositions).set({ userId: DEMO_USER_ID }).where(eq(closedPositions.userId, legacyId));

      if (existingDemoById) {
        await tx.delete(users).where(eq(users.id, legacyId));
      } else {
        await tx
          .update(users)
          .set({
            id: DEMO_USER_ID,
            username: DEFAULT_SESSION_USERNAME,
            password: DEFAULT_SESSION_PASSWORD,
          })
          .where(eq(users.id, legacyId));
      }
    }

    await tx
      .insert(users)
      .values({
        id: DEMO_USER_ID,
        username: DEFAULT_SESSION_USERNAME,
        password: DEFAULT_SESSION_PASSWORD,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          username: DEFAULT_SESSION_USERNAME,
          password: DEFAULT_SESSION_PASSWORD,
        },
      });

    const [user] = await tx.select().from(users).where(eq(users.id, DEMO_USER_ID)).limit(1);

    if (!user) {
      throw new Error("Failed to resolve demo user account");
    }

    return user;
  });
}

async function ensureDefaultUser() {
  const user = await ensureDemoUserRecord();

  let settings = await storage.getUserSettings(user.id);
  if (!settings || settings.userId !== user.id) {
    settings = await storage.upsertUserSettings({
      userId: user.id,
      ...DEFAULT_USER_SETTINGS,
    });
  }

  if (!settings) {
    throw new Error("Failed to ensure default user settings");
  }

  await storage.ensureIndicatorConfigsSeed(user.id);

  return { user, settings };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

type Deps = {
  broker: Broker;
  binanceService: BinanceService;
  telegramService: TelegramService;
  indicatorService: IndicatorService;
  broadcast: (data: any) => void;
};

const indicatorConfigPayloadSchema = z.object({
  name: z.string().min(1, "Indicator name is required"),
  payload: z.record(z.any()).default({}),
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
  timeframes: z.array(z.string().min(1)).max(12),
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

const accountSettingsPatchSchema = z
  .object({
    demoEnabled: z.boolean().optional(),
    defaultTpPct: z.union([z.number(), z.string()]).optional(),
    defaultSlPct: z.union([z.number(), z.string()]).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.demoEnabled == null && value.defaultTpPct == null && value.defaultSlPct == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide at least one field to update",
      });
    }
  });

const tradeCloseSchema = z.object({
  positionId: z.string().min(1),
  exitPrice: z.union([z.number(), z.string()]).optional(),
  feeUsd: z.union([z.number(), z.string()]).optional(),
});

function normalizeColumnList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim().replace(/"/g, ""))
    .filter((part) => part.length > 0);
}

async function verifyIndexRequirement(spec: Extract<HealthIndexSpec, { type: "index" }>): Promise<string | null> {
  const { rows } = await pool.query<{ indexdef: string }>(
    `
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = $1
      LIMIT 1;
    `,
    [spec.name],
  );

  const definition = rows[0]?.indexdef;
  if (!definition) {
    return `missing index public.${spec.name}`;
  }

  const normalized = definition.toLowerCase();
  const tableMatch = normalized.includes(`on public.${spec.table}`);
  const uniqueMatches = spec.unique ? normalized.startsWith("create unique index") : true;

  const columnMatch = (() => {
    const match = definition.match(/\(([^)]+)\)/);
    if (!match) {
      return false;
    }
    const columns = normalizeColumnList(match[1] ?? "").map((column) => column.toLowerCase());
    if (columns.length !== spec.columns.length) {
      return false;
    }
    return spec.columns.every((column, index) => columns[index] === column.toLowerCase());
  })();

  if (!tableMatch || !columnMatch || !uniqueMatches) {
    return `index public.${spec.name} has unexpected definition`;
  }

  return null;
}

async function verifyConstraintRequirement(spec: Extract<HealthIndexSpec, { type: "constraint" }>): Promise<string | null> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE c.conname = $1 AND n.nspname = 'public' AND t.relname = $2
      ) AS exists;
    `,
    [spec.name, spec.table],
  );

  if (!rows[0]?.exists) {
    return `constraint public.${spec.table}.${spec.name} missing`;
  }

  return null;
}

async function performHealthCheck(): Promise<{ ok: boolean; issues: string[] }> {
  const issues: string[] = [];

  try {
    await pool.query("SELECT 1");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    issues.push(`database connectivity failed: ${message}`);
    return { ok: false, issues };
  }

  for (const spec of HEALTH_CHECK_REQUIREMENTS) {
    try {
      const issue =
        spec.type === "index"
          ? await verifyIndexRequirement(spec)
          : await verifyConstraintRequirement(spec);
      if (issue) {
        issues.push(issue);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push(`unable to verify ${spec.type} ${spec.name}: ${message}`);
    }
  }

  return { ok: issues.length === 0, issues };
}

function respondWithError(res: Response, scope: string, error: unknown, fallback: string) {
  if (error instanceof ZodError) {
    const firstError = error.errors[0]?.message ?? "Invalid request";
    logError(`${scope} validation`, error).catch(() => {});
    return res.status(400).json({ error: true, message: firstError });
  }
  if (error instanceof QuantityValidationError) {
    logError(`${scope} validation`, error).catch(() => {});
    return res.status(400).json({ error: true, message: error.message });
  }

  const details = error instanceof Error ? error.message : undefined;
  logError(scope, error).catch(() => {});
  const payload: Record<string, unknown> = { error: true, message: fallback };
  if (details && details !== fallback) {
    payload.details = details;
  }
  return res.status(500).json(payload);
}

export function registerRoutes(app: Express, deps: Deps): void {
  const { broker, binanceService, telegramService, indicatorService, broadcast } = deps;

  app.get("/healthz", async (_req, res) => {
    const status = await performHealthCheck();
    if (!status.ok) {
      return res.status(503).json({ ok: false, issues: status.issues });
    }
    return res.status(200).json({ ok: true });
  });

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

  const resolveUserId = async (value: unknown): Promise<string> => {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
    const { user } = await ensureDefaultUser();
    return user.id;
  };

  const parseNumeric = (value: unknown): number | undefined => {
    if (value == null) {
      return undefined;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const computeDefaultTargets = (
    side: "LONG" | "SHORT",
    entryPrice: number,
    settings?: UserSettings | null,
  ): { takeProfit?: string; stopLoss?: string } => {
    if (!settings || settings.demoEnabled === false || !Number.isFinite(entryPrice) || entryPrice <= 0) {
      return {};
    }

    const tpPct = parseNumeric(settings.defaultTpPct);
    const slPct = parseNumeric(settings.defaultSlPct);
    const normalise = (value: number) => (Number.isFinite(value) ? value.toFixed(8) : undefined);

    let takeProfit: string | undefined;
    if (tpPct && tpPct > 0) {
      const multiplier = tpPct / 100;
      const price = side === "LONG" ? entryPrice * (1 + multiplier) : entryPrice * (1 - multiplier);
      takeProfit = normalise(price);
    }

    let stopLoss: string | undefined;
    if (slPct && slPct > 0) {
      const multiplier = slPct / 100;
      const price = side === "LONG" ? entryPrice * (1 - multiplier) : entryPrice * (1 + multiplier);
      stopLoss = normalise(Math.max(price, 0.00000001));
    }

    return { takeProfit, stopLoss };
  };

  const computePnlForPosition = (position: Position, exitPrice: number) => {
    const entry = parseNumeric(position.entryPrice) ?? 0;
    const size = parseNumeric(position.size) ?? 0;
    const pnl =
      position.side === "LONG"
        ? (exitPrice - entry) * size
        : (entry - exitPrice) * size;
    return Number.isFinite(pnl) ? pnl : 0;
  };

  const closePositionAndRecord = async (
    position: Position,
    exitPrice: number,
    feeUsdInput?: number,
  ) => {
    const exit = Number.isFinite(exitPrice) ? exitPrice : parseNumeric(position.currentPrice) ?? parseNumeric(position.entryPrice) ?? 0;
    const feeUsd = Number.isFinite(feeUsdInput ?? NaN) ? Number(feeUsdInput) : 0;
    const grossPnl = computePnlForPosition(position, exit);
    const netPnl = grossPnl - (Number.isFinite(feeUsd) ? feeUsd : 0);
    const exitPriceStr = exit.toFixed(8);
    const feeStr = feeUsd.toFixed(8);
    const pnlStr = netPnl.toFixed(8);
    const closedAt = new Date();

    const updated = await storage.closePosition(position.id, {
      closePrice: exitPriceStr,
      pnl: pnlStr,
    });

    const openedAt = position.openedAt instanceof Date ? position.openedAt : new Date(position.openedAt ?? Date.now());

    const closedRecord = await storage.insertClosedPosition({
      userId: position.userId,
      symbol: position.symbol,
      side: position.side,
      size: position.size,
      entryPrice: position.entryPrice,
      exitPrice: exitPriceStr,
      feeUsd: feeStr,
      pnlUsd: pnlStr,
      openedAt,
      closedAt,
    });

    return { updated, closedRecord, pnlUsd: netPnl, exitPrice: exitPriceStr, feeUsd: feeStr };
  };

  app.get("/api/session", async (_req, res) => {
    try {
      await userSettingsGuardBootstrap;
      const { user, settings } = await withTimeout(
        ensureDefaultUser(),
        SESSION_TIMEOUT_MS,
        SESSION_TIMEOUT_MESSAGE,
      );

      return res.json({
        userId: user.id,
        demo: user.id === DEMO_USER_ID,
        settings,
        serverTime: new Date().toISOString(),
      });
    } catch (error) {
      const fallback = {
        userId: DEMO_USER_ID,
        demo: true,
        settings: null,
        serverTime: new Date().toISOString(),
      } as const;

      const pgError = error as DatabaseError | undefined;
      if (pgError && typeof pgError === "object" && "code" in pgError) {
        console.warn("[session] failed to initialise session", {
          message: pgError.message,
          code: pgError.code,
          constraint: pgError.constraint,
          detail: (pgError as { detail?: unknown }).detail,
        });
        void logError("GET /api/session", {
          message: pgError.message,
          code: pgError.code,
          constraint: pgError.constraint,
          detail: (pgError as { detail?: unknown }).detail,
        });
      } else {
        console.warn("[session] failed to initialise session", error);
        void logError("GET /api/session", error);
      }

      return res.json({
        ...fallback,
        warning:
          "Failed to initialise session. Database schema mismatch detected. Please run migrations.",
      });
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
      const { user } = await ensureDefaultUser();
      await storage.deleteAllClosedPositions();
      if (user?.id) {
        await storage.deleteIndicatorConfigsForUser(user.id);
        await storage.ensureIndicatorConfigsSeed(user.id);
      }
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

  app.patch("/api/settings/account", async (req, res) => {
    try {
      const patch = accountSettingsPatchSchema.parse(req.body ?? {});
      const { user } = await ensureDefaultUser();
      const existing = (await storage.getUserSettings(user.id)) ?? null;

      const base: any = existing
        ? { ...existing }
        : { userId: user.id, isTestnet: true, defaultLeverage: 1, riskPercent: 2, demoEnabled: true };

      delete base.id;
      delete base.createdAt;
      delete base.updatedAt;

      if (patch.demoEnabled != null) {
        base.demoEnabled = patch.demoEnabled;
      }

      if (patch.defaultTpPct != null) {
        const value = Number(patch.defaultTpPct);
        if (!Number.isFinite(value) || value <= 0 || value > 50) {
          return res.status(400).json({ message: "Default TP % must be between 0 and 50" });
        }
        base.defaultTpPct = value;
      }

      if (patch.defaultSlPct != null) {
        const value = Number(patch.defaultSlPct);
        if (!Number.isFinite(value) || value <= 0 || value > 50) {
          return res.status(400).json({ message: "Default SL % must be between 0 and 50" });
        }
        base.defaultSlPct = value;
      }

      base.userId = user.id;

      const result = await storage.upsertUserSettings(base);
      res.json(result);
    } catch (error) {
      respondWithError(res, "PATCH /api/settings/account", error, "Failed to update account settings");
    }
  });

  app.get("/api/positions/open", async (req, res) => {
    try {
      const userId = await resolveUserId(req.query.userId);
      const positions = await storage.getOpenPositions(userId);
      res.json(positions);
    } catch (error) {
      respondWithError(res, "GET /api/positions/open", error, "Failed to fetch open positions");
    }
  });

  app.get("/api/positions/closed", async (req, res) => {
    try {
      const userId = await resolveUserId(req.query.userId);
      const symbol = typeof req.query.symbol === "string" && req.query.symbol.trim().length > 0 ? req.query.symbol : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const offset = req.query.offset ? Number(req.query.offset) : undefined;
      const closed = await storage.getClosedPositions(userId, { symbol, limit, offset });
      res.json(closed);
    } catch (error) {
      respondWithError(res, "GET /api/positions/closed", error, "Failed to fetch closed positions");
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

      const parsedPosition = insertPositionSchema.parse({
        ...request,
        entryPrice: request.entryPrice ?? "0",
      });

      const side = parsedPosition.side === "LONG" ? "BUY" : "SELL";
      const qty = parseFloat(parsedPosition.size);
      const order = await broker.placeOrder({
        symbol: parsedPosition.symbol,
        side,
        type: "MARKET",
        qty,
      });

      if (!order) {
        return res.status(400).json({ message: "Failed to execute trade" });
      }

      const entryFill = order.fills?.[0]?.price;
      const entryPrice = entryFill != null ? entryFill.toString() : parsedPosition.entryPrice;
      const userSettings = await storage.getUserSettings(parsedPosition.userId);
      const defaults = computeDefaultTargets(parsedPosition.side as "LONG" | "SHORT", Number(entryPrice), userSettings);

      const positionToSave: typeof parsedPosition = {
        ...parsedPosition,
        orderId: order.orderId,
        entryPrice,
        currentPrice: entryPrice,
        stopLoss: parsedPosition.stopLoss ?? defaults.stopLoss ?? undefined,
        takeProfit: parsedPosition.takeProfit ?? defaults.takeProfit ?? undefined,
      };

      const result = await storage.createPosition(positionToSave);

      await telegramService.sendTradeNotification({
        action: "opened",
        symbol: result.symbol,
        side: result.side,
        size: result.size,
        price: result.entryPrice,
        stopLoss: result.stopLoss ?? undefined,
        takeProfit: result.takeProfit ?? undefined,
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

      const marketPrice = getLastPrice(position.symbol);
      const fallbackPrice = parseNumeric(position.currentPrice) ?? parseNumeric(position.entryPrice) ?? 0;
      const exitPrice = marketPrice ?? fallbackPrice;

      const { updated } = await closePositionAndRecord(position, exitPrice, 0);

      broadcast({ type: "position_closed", data: updated });
      res.json(updated);
    } catch (error) {
      respondWithError(res, "DELETE /api/positions/:id", error, "Failed to close position");
    }
  });

  app.post("/api/positions/:userId/close-all", async (req, res) => {
    try {
      const userId = await resolveUserId(req.params.userId);
      const openPositions = await storage.getOpenPositions(userId);

      const closed: Position[] = [];
      for (const position of openPositions) {
        const marketPrice = getLastPrice(position.symbol);
        const fallbackPrice = parseNumeric(position.currentPrice) ?? parseNumeric(position.entryPrice) ?? 0;
        const exitPrice = marketPrice ?? fallbackPrice;
        const { updated } = await closePositionAndRecord(position, exitPrice, 0);
        closed.push(updated);
        broadcast({ type: "position_closed", data: updated });
      }

      if (closed.length > 0) {
        await telegramService.sendNotification("🛑 All positions have been closed");
      }

      broadcast({ type: "all_positions_closed", userId });
      res.json({ message: "All positions closed", count: closed.length });
    } catch (error) {
      respondWithError(res, "POST /api/positions/:userId/close-all", error, "Failed to close all positions");
    }
  });

  app.post("/api/trades/close", async (req, res) => {
    try {
      const payload = tradeCloseSchema.parse(req.body ?? {});
      const position = await storage.getPositionById(payload.positionId);
      if (!position) {
        return res.status(404).json({ message: "Position not found" });
      }

      const providedPrice = parseNumeric(payload.exitPrice);
      const marketPrice = getLastPrice(position.symbol);
      const fallbackPrice = parseNumeric(position.currentPrice) ?? parseNumeric(position.entryPrice) ?? 0;
      const exitPrice = providedPrice ?? marketPrice ?? fallbackPrice;
      const feeUsd = parseNumeric(payload.feeUsd) ?? 0;

      const { closedRecord, updated } = await closePositionAndRecord(position, exitPrice, feeUsd);

      broadcast({ type: "position_closed", data: updated });
      res.json(closedRecord);
    } catch (error) {
      respondWithError(res, "POST /api/trades/close", error, "Failed to close trade");
    }
  });

  app.get("/api/stats/summary", async (_req, res) => {
    try {
      const rows = await db.select().from(closedPositions);

      const computePnlUsd = (row: typeof rows[number]) => {
        const entryPx = Number(row.entryPrice ?? 0);
        const exitPx = Number(row.exitPrice ?? 0);
        const size = Number(row.size ?? 0);
        const fee = Number(row.feeUsd ?? 0);

        if (!Number.isFinite(entryPx) || !Number.isFinite(exitPx) || !Number.isFinite(size)) {
          return 0;
        }

        const direction = row.side === "LONG" ? 1 : -1;
        const pnl = (exitPx - entryPx) * direction * size - (Number.isFinite(fee) ? fee : 0);
        return Number.isFinite(pnl) ? pnl : 0;
      };

      const rowsWithPnl = rows.map((row) => ({ ...row, computedPnlUsd: computePnlUsd(row) }));

      const totalTrades = rowsWithPnl.length;
      const totalPnl = rowsWithPnl.reduce((sum, row) => sum + row.computedPnlUsd, 0);
      const winningTrades = rowsWithPnl.filter((row) => row.computedPnlUsd > 0).length;
      const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

      let rewardSum = 0;
      let rewardCount = 0;
      for (const row of rowsWithPnl) {
        const entryPx = Number(row.entryPrice ?? 0);
        const exitPx = Number(row.exitPrice ?? 0);
        if (!Number.isFinite(entryPx) || entryPx === 0) {
          continue;
        }
        const delta = row.side === "LONG" ? exitPx - entryPx : entryPx - exitPx;
        rewardSum += delta / entryPx;
        rewardCount += 1;
      }
      const avgReward = rewardCount > 0 ? rewardSum / rewardCount : 0;

      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const last30dPnl = rowsWithPnl
        .filter((row) => row.closedAt && new Date(row.closedAt) >= cutoff)
        .reduce((sum, row) => sum + row.computedPnlUsd, 0);

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

  app.get("/api/indicators/configs", async (req, res) => {
    try {
      const userId = await resolveUserId(req.query.userId);
      const configs = await storage.getIndicatorConfigs(userId);
      res.json(configs);
    } catch (error) {
      respondWithError(res, "GET /api/indicators/configs", error, "Failed to fetch indicator configurations");
    }
  });

  app.post("/api/indicators/configs", async (req, res) => {
    try {
      const payload = indicatorConfigPayloadSchema.parse(req.body ?? {});
      const userId = await resolveUserId(req.query.userId);
      const result = await storage.createIndicatorConfig({
        userId,
        name: payload.name,
        payload: payload.payload,
      });
      res.status(201).json(result);
    } catch (error) {
      respondWithError(res, "POST /api/indicators/configs", error, "Failed to save indicator configuration");
    }
  });

  app.delete("/api/indicators/configs/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const userId = await resolveUserId(req.query.userId);
      await storage.deleteIndicatorConfig(id, userId);
      res.status(204).end();
    } catch (error) {
      respondWithError(res, "DELETE /api/indicators/configs/:id", error, "Failed to delete indicator configuration");
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
      const rows = await storage.replacePairTimeframes(payload.symbol, payload.timeframes);
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
