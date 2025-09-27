import type { Express, Response } from "express";
import type { Broker } from "./broker/types";
import type { DatabaseError } from "pg";
import Decimal from "decimal.js";
import { z, ZodError } from "zod";

import { storage } from "./storage";
import { db, pool } from "./db";
import { cached, MICRO_CACHE_TTL_MS, clearCacheKey } from "./cache/apiCache";
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
import { get24hChangeForSymbols } from "./services/market24h";
import { getLastPrice as getPaperLastPrice } from "./paper/PriceFeed";
import { startRiskWatcher } from "./services/riskWatcher";
import { getAccountSnapshot, updateAccountSnapshot } from "./state/accountSnapshot";
import { logError } from "./utils/logger";
import { resolveIndicatorType } from "./utils/indicatorConfigs";
import { ensureUserSettingsGuard } from "./scripts/dbGuard";
import * as statsController from "./controllers/stats";
import { getLastPrice as getMetricsLastPrice } from "./services/metrics";
import {
  SUPPORTED_TIMEFRAMES,
  type OpenPositionResponse,
  type StatsSummaryResponse,
} from "@shared/types";

const DEFAULT_SESSION_USERNAME = process.env.DEFAULT_USER ?? "demo";
const DEFAULT_SESSION_PASSWORD = process.env.DEFAULT_USER_PASSWORD ?? "demo";
const LEGACY_DEMO_USER_ID = "00000000-0000-0000-0000-000000000001";
const DEMO_EMAIL = "demo@local";
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
  {
    type: "index",
    name: "user_pair_settings_user_symbol_uniq",
    table: "user_pair_settings",
    columns: ["user_id", "symbol"],
    unique: true,
  },
];

const SUPPORTED_TIMEFRAME_SET = new Set<string>(SUPPORTED_TIMEFRAMES);

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
  totalBalance: "10000.00",
} as const;

async function ensureDemoUserRecord(): Promise<User> {
  return db.transaction(async (tx) => {
    const [existingByEmail] = await tx.select().from(users).where(eq(users.email, DEMO_EMAIL)).limit(1);
    const [legacyById] = await tx.select().from(users).where(eq(users.id, LEGACY_DEMO_USER_ID)).limit(1);
    const [legacyByUsername] = await tx
      .select()
      .from(users)
      .where(eq(users.username, DEFAULT_SESSION_USERNAME))
      .limit(1);

    if (!existingByEmail && (legacyByUsername || legacyById)) {
      const source = legacyByUsername ?? legacyById;
      if (source) {
        await tx
          .update(users)
          .set({
            email: DEMO_EMAIL,
            username: DEFAULT_SESSION_USERNAME,
            password: DEFAULT_SESSION_PASSWORD,
          })
          .where(eq(users.id, source.id));
      }
    }

    const [upserted] = await tx
      .insert(users)
      .values({
        email: DEMO_EMAIL,
        username: DEFAULT_SESSION_USERNAME,
        password: DEFAULT_SESSION_PASSWORD,
      })
      .onConflictDoUpdate({
        target: users.email,
        set: {
          username: DEFAULT_SESSION_USERNAME,
          password: DEFAULT_SESSION_PASSWORD,
        },
      })
      .returning();

    const demoUser = upserted ?? existingByEmail ?? legacyByUsername ?? legacyById;

    if (!demoUser) {
      throw new Error("Failed to resolve demo user account");
    }

    await tx
      .update(users)
      .set({
        email: DEMO_EMAIL,
        username: DEFAULT_SESSION_USERNAME,
        password: DEFAULT_SESSION_PASSWORD,
      })
      .where(eq(users.id, demoUser.id));

    const legacyIds = new Set<string>();
    if (legacyByUsername && legacyByUsername.id !== demoUser.id) {
      legacyIds.add(legacyByUsername.id);
    }
    if (legacyById && legacyById.id !== demoUser.id) {
      legacyIds.add(legacyById.id);
    }

    for (const legacyId of Array.from(legacyIds)) {
      const [legacySettings] = await tx
        .select({ id: userSettings.id })
        .from(userSettings)
        .where(eq(userSettings.userId, legacyId))
        .limit(1);

      if (legacySettings) {
        const [demoSettings] = await tx
          .select({ id: userSettings.id })
          .from(userSettings)
          .where(eq(userSettings.userId, demoUser.id))
          .limit(1);

        if (demoSettings) {
          await tx.delete(userSettings).where(eq(userSettings.userId, legacyId));
        } else {
          await tx.update(userSettings).set({ userId: demoUser.id }).where(eq(userSettings.userId, legacyId));
        }
      }

      await tx.update(indicatorConfigs).set({ userId: demoUser.id }).where(eq(indicatorConfigs.userId, legacyId));
      await tx.update(positions).set({ userId: demoUser.id }).where(eq(positions.userId, legacyId));
      await tx.update(closedPositions).set({ userId: demoUser.id }).where(eq(closedPositions.userId, legacyId));

      await tx.delete(users).where(eq(users.id, legacyId));
    }

    const [resolved] = await tx.select().from(users).where(eq(users.id, demoUser.id)).limit(1);

    if (!resolved) {
      throw new Error("Failed to resolve demo user account");
    }

    return resolved;
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

  const snapshot = getAccountSnapshot();
  if (snapshot && Number.isFinite(snapshot.totalBalance)) {
    const storedBalance = Number(settings.totalBalance ?? 0);
    const snapshotBalance = snapshot.totalBalance;
    const shouldSync = !Number.isFinite(storedBalance) || Math.abs(storedBalance - snapshotBalance) >= 0.01;
    if (shouldSync) {
      try {
        settings = await storage.upsertUserSettings({
          userId: user.id,
          totalBalance: snapshotBalance.toFixed(2),
        });
      } catch (error) {
        console.warn(
          `[session] failed to sync account snapshot: ${(error as Error).message ?? error}`,
        );
      }
    }
  }

  try {
    await storage.ensureIndicatorConfigsSeed(user.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[session] indicator config seed failed: ${message}`);
  }

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
  type: z.string().min(1).optional(),
});

const quickTradeRequestSchema = z
  .object({
    mode: z.enum(["QTY", "USDT"]),
    symbol: z.string().min(1, "Symbol is required"),
    side: z.enum(["LONG", "SHORT"]),
    qty: z.union([z.string(), z.number()]).optional(),
    usdtAmount: z.union([z.string(), z.number()]).optional(),
    tp_price: z.union([z.string(), z.number(), z.null()]).optional(),
    sl_price: z.union([z.string(), z.number(), z.null()]).optional(),
    leverage: z.union([z.string(), z.number()]).optional(),
  })
  .superRefine((data, ctx) => {
    const qtyValue = data.qty != null ? Number(data.qty) : undefined;
    const usdtValue = data.usdtAmount != null ? Number(data.usdtAmount) : undefined;

    if (data.mode === "QTY") {
      if (!qtyValue || !Number.isFinite(qtyValue) || qtyValue <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Quantity must be greater than zero",
          path: ["qty"],
        });
      }
    } else if (data.mode === "USDT") {
      if (!usdtValue || !Number.isFinite(usdtValue) || usdtValue <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "USDT amount must be greater than zero",
          path: ["usdtAmount"],
        });
      }
    }

    if (data.tp_price != null && Number(data.tp_price) <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Take profit must be greater than zero",
        path: ["tp_price"],
      });
    }
    if (data.sl_price != null && Number(data.sl_price) <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Stop loss must be greater than zero",
        path: ["sl_price"],
      });
    }
  });

const pairSettingsPayloadSchema = z
  .object({
    activeTimeframes: z.array(z.string()).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    const values = Array.isArray(data.activeTimeframes) ? data.activeTimeframes : [];
    const invalid = values
      .map((value) => value?.toString().trim())
      .filter((value): value is string => Boolean(value) && !SUPPORTED_TIMEFRAME_SET.has(value));
    if (invalid.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unsupported timeframe(s): ${invalid.join(", ")}`,
        path: ["activeTimeframes"],
      });
    }
  });

function normalizeActiveTimeframes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string") {
      continue;
    }
    const trimmed = raw.trim();
    if (trimmed && SUPPORTED_TIMEFRAME_SET.has(trimmed)) {
      result.add(trimmed);
    }
  }
  return Array.from(result);
}

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
    totalBalance: z.union([z.number(), z.string()]).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.demoEnabled == null &&
      value.defaultTpPct == null &&
      value.defaultSlPct == null &&
      value.totalBalance == null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide at least one field to update",
      });
    }
  });

const riskPatchSchema = z.object({
  tpPrice: z.union([z.number(), z.string(), z.null()]).optional(),
  slPrice: z.union([z.number(), z.string(), z.null()]).optional(),
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

  app.get("/stats/change", statsController.change);
  app.get("/api/stats/change", statsController.change);

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

  const decimalOrNull = (value: unknown): Decimal | null => {
    try {
      if (value == null || value === "") {
        return null;
      }
      const decimalValue = new Decimal(value as Decimal.Value);
      if (!decimalValue.isFinite()) {
        return null;
      }
      return decimalValue;
    } catch {
      return null;
    }
  };

  const decimalOrZero = (value: unknown): Decimal => {
    const resolved = decimalOrNull(value);
    return resolved ?? new Decimal(0);
  };

  const formatDecimal = (value: Decimal, decimals: number): string => {
    return value.toDecimalPlaces(decimals, Decimal.ROUND_DOWN).toFixed(decimals);
  };

  const toDecimalString = (value: number, decimals: number = 8): string => {
    return Number.isFinite(value) ? value.toFixed(decimals) : (0).toFixed(decimals);
  };

  const resolveQty = (position: Position): number => {
    const rawQty = parseNumeric(position.qty);
    const sizeValue = parseNumeric(position.amountUsd ?? position.size);
    const entry = parseNumeric(position.entryPrice);

    if (typeof rawQty === "number" && rawQty > 0) {
      const qtyMatchesSize =
        typeof sizeValue === "number" && sizeValue > 0 && Math.abs(rawQty - sizeValue) <= 1e-8;
      if (!qtyMatchesSize) {
        return Number(rawQty.toFixed(8));
      }
    }

    if (typeof sizeValue === "number" && typeof entry === "number" && entry > 0) {
      const computed = sizeValue / entry;
      return Number.isFinite(computed) ? Number(computed.toFixed(8)) : 0;
    }

    if (typeof rawQty === "number" && rawQty > 0) {
      return Number(rawQty.toFixed(8));
    }

    return 0;
  };

  const resolveSizeUsd = (position: Position, qty: number, entryPrice: number): number => {
    const storedAmount = parseNumeric(position.amountUsd ?? position.size);
    if (typeof storedAmount === "number" && storedAmount > 0) {
      return storedAmount;
    }
    if (qty > 0 && entryPrice > 0) {
      const computed = qty * entryPrice;
      return Number.isFinite(computed) ? computed : 0;
    }
    return 0;
  };

  const computeOpenMetrics = async (
    openPositionRows: Position[],
  ): Promise<{ openPnL: Decimal; marginUsed: Decimal }> => {
    if (!Array.isArray(openPositionRows) || openPositionRows.length === 0) {
      return { openPnL: new Decimal(0), marginUsed: new Decimal(0) };
    }

    const symbolSet = new Set<string>();
    for (const position of openPositionRows) {
      if (position?.symbol) {
        symbolSet.add(String(position.symbol).toUpperCase());
      }
    }

    const priceEntries = await Promise.all(
      Array.from(symbolSet).map(async (symbol) => {
        try {
          const metric = await getMetricsLastPrice(symbol);
          const price = decimalOrNull(metric.value);
          return [symbol, price?.gt(0) ? price : null] as const;
        } catch (error) {
          console.warn(
            `[stats] failed to resolve last price for ${symbol}: ${(error as Error).message ?? error}`,
          );
          return [symbol, null] as const;
        }
      }),
    );

    const priceMap = new Map<string, Decimal>();
    for (const [symbol, price] of priceEntries) {
      if (price) {
        priceMap.set(symbol, price);
      }
    }

    let openPnL = new Decimal(0);
    let marginUsed = new Decimal(0);

    for (const position of openPositionRows) {
      const entryPrice = decimalOrNull(position.entryPrice);
      if (!entryPrice || !entryPrice.isFinite() || entryPrice.lte(0)) {
        continue;
      }

      let qty = decimalOrNull(position.qty);
      if (!qty || qty.lte(0)) {
        const amountUsd = decimalOrNull(position.amountUsd ?? position.size);
        if (amountUsd && amountUsd.gt(0)) {
          try {
            qty = amountUsd.div(entryPrice);
          } catch {
            qty = null;
          }
        }
      }

      if (!qty || !qty.isFinite() || qty.lte(0)) {
        continue;
      }

      const normalizedSymbol = String(position.symbol ?? "").toUpperCase();
      const markPrice = priceMap.get(normalizedSymbol);
      const fallbackPrice = decimalOrNull(position.currentPrice) ?? entryPrice;
      const price = markPrice && markPrice.gt(0) ? markPrice : fallbackPrice;
      if (!price || !price.isFinite() || price.lte(0)) {
        continue;
      }

      const side = String(position.side ?? "").toUpperCase();
      let positionPnl = new Decimal(0);
      if (side === "LONG") {
        positionPnl = price.minus(entryPrice).times(qty);
      } else if (side === "SHORT") {
        positionPnl = entryPrice.minus(price).times(qty);
      }

      if (positionPnl.isFinite()) {
        openPnL = openPnL.plus(positionPnl);
      }

      const amountUsd = decimalOrNull(position.amountUsd ?? position.size);
      if (amountUsd && amountUsd.isFinite() && amountUsd.gt(0)) {
        marginUsed = marginUsed.plus(amountUsd);
      } else {
        marginUsed = marginUsed.plus(entryPrice.times(qty));
      }
    }

    return { openPnL, marginUsed };
  };

  const computeEquitySnapshot = async (
    settings: UserSettings,
    openPositionRows?: Position[],
  ): Promise<{ totalBalance: Decimal; openPnL: Decimal; equity: Decimal }> => {
    const totalBalance = decimalOrZero(settings.totalBalance ?? 0).toDecimalPlaces(2);
    const positionsList = openPositionRows ?? (await storage.getAllOpenPositions());
    const { openPnL } = await computeOpenMetrics(positionsList);
    const equity = totalBalance.plus(openPnL);
    return { totalBalance, openPnL, equity };
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
    const qty = resolveQty(position);
    if (qty <= 0) {
      return 0;
    }
    const pnl =
      position.side === "LONG"
        ? (exitPrice - entry) * qty
        : (entry - exitPrice) * qty;
    return Number.isFinite(pnl) ? pnl : 0;
  };

  const closePositionAndRecord = async (
    position: Position,
    exitPrice: number,
    feeUsdInput?: number,
  ) => {
    const exit = Number.isFinite(exitPrice) ? exitPrice : parseNumeric(position.currentPrice) ?? parseNumeric(position.entryPrice) ?? 0;
    const feeUsd = Number.isFinite(feeUsdInput ?? NaN) ? Number(feeUsdInput) : 0;
    const qty = resolveQty(position);
    const grossPnl = qty > 0 ? computePnlForPosition(position, exit) : 0;
    const netPnl = grossPnl - (Number.isFinite(feeUsd) ? feeUsd : 0);
    const exitPriceStr = toDecimalString(exit);
    const feeStr = toDecimalString(feeUsd);
    const pnlStr = toDecimalString(netPnl);
    const closedAt = new Date();

    const updated = await storage.closePosition(position.id, {
      closePrice: exitPriceStr,
      pnl: pnlStr,
    });

    const openedAt = position.openedAt instanceof Date ? position.openedAt : new Date(position.openedAt ?? Date.now());
    const qtyStr = qty > 0 ? toDecimalString(qty) : undefined;

    const closedRecord = await storage.insertClosedPosition({
      userId: position.userId,
      symbol: position.symbol,
      side: position.side,
      size: qtyStr ?? (position.qty ?? position.amountUsd ?? position.size ?? "0"),
      entryPrice: position.entryPrice,
      exitPrice: exitPriceStr,
      feeUsd: feeStr,
      pnlUsd: pnlStr,
      openedAt,
      closedAt,
    });

    console.info(
      `[trade] closed ${position.symbol} ${position.side} qty=${qtyStr ?? position.qty ?? position.size ?? ''} exit=${exitPriceStr} pnl=${pnlStr}`,
    );
    void telegramService.sendTradeNotification({
      action: 'closed',
      symbol: position.symbol,
      side: position.side,
      size: qtyStr ?? String(position.qty ?? position.size ?? ''),
      price: exitPriceStr,
      pnl: pnlStr,
      stopLoss: updated.stopLoss ?? updated.slPrice ?? undefined,
      takeProfit: updated.takeProfit ?? updated.tpPrice ?? undefined,
    });

    clearCacheKey("positions:open");
    clearCacheKey(`positions:open:${position.userId}`);

    return { updated, closedRecord, pnlUsd: netPnl, exitPrice: exitPriceStr, feeUsd: feeStr, qty };
  };

  const resolveTargetPrice = (
    candidate: unknown,
    fallback: unknown,
    targetType: "tp" | "sl",
    side: "LONG" | "SHORT",
    entryPrice: number,
  ): string | null => {
    const candidateNumeric = parseNumeric(candidate);
    const fallbackNumeric = parseNumeric(fallback);

    const isPositive = (value: number | undefined): value is number =>
      typeof value === "number" && Number.isFinite(value) && value > 0;

    const respectsDirection = (value: number): boolean => {
      if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
        return true;
      }
      if (targetType === "tp") {
        return side === "LONG" ? value > entryPrice : value < entryPrice;
      }
      return side === "LONG" ? value < entryPrice : value > entryPrice;
    };

    const candidateValid = isPositive(candidateNumeric) ? candidateNumeric : undefined;
    const fallbackValid = isPositive(fallbackNumeric) ? fallbackNumeric : undefined;

    const directionalCandidate =
      candidateValid !== undefined && respectsDirection(candidateValid)
        ? candidateValid
        : undefined;
    const directionalFallback =
      fallbackValid !== undefined && respectsDirection(fallbackValid)
        ? fallbackValid
        : undefined;

    const chooseClosest = (first?: number, second?: number): number | undefined => {
      if (first != null && second != null) {
        const firstDiff = Math.abs(first - entryPrice);
        const secondDiff = Math.abs(second - entryPrice);
        return firstDiff <= secondDiff ? first : second;
      }
      return first ?? second;
    };

    const directionalChoice = chooseClosest(directionalCandidate, directionalFallback);
    if (directionalChoice != null) {
      return toDecimalString(directionalChoice);
    }

    const fallbackChoice = chooseClosest(candidateValid, fallbackValid);
    return fallbackChoice != null ? toDecimalString(fallbackChoice) : null;
  };

  const buildOpenPositionResponse = (position: Position): OpenPositionResponse => {
    const entryPrice = parseNumeric(position.entryPrice) ?? 0;
    const qty = resolveQty(position);
    const sizeUsd = resolveSizeUsd(position, qty, entryPrice);
    const storedAmountUsd = parseNumeric(position.amountUsd);
    const amountUsdValue = typeof storedAmountUsd === "number" && storedAmountUsd > 0 ? storedAmountUsd : sizeUsd;
    const leverageValue = parseNumeric(position.leverage);
    const lastPrice = getPaperLastPrice(position.symbol);
    const storedCurrent = parseNumeric(position.currentPrice);
    const marketPrice =
      typeof lastPrice === "number" && Number.isFinite(lastPrice)
        ? lastPrice
        : storedCurrent ?? entryPrice;
    const pnlUsd = qty > 0 ? computePnlForPosition(position, marketPrice) : 0;
    const rawSide = String(position.side ?? "").toUpperCase();
    const normalizedSide: "LONG" | "SHORT" = rawSide === "SHORT" ? "SHORT" : "LONG";
    const tpPrice = resolveTargetPrice(
      position.tpPrice,
      position.takeProfit,
      "tp",
      normalizedSide,
      entryPrice,
    );
    const slPrice = resolveTargetPrice(
      position.slPrice,
      position.stopLoss,
      "sl",
      normalizedSide,
      entryPrice,
    );
    const currentPriceStr = Number.isFinite(marketPrice) ? toDecimalString(marketPrice) : undefined;
    const openedAt =
      position.openedAt instanceof Date
        ? position.openedAt.toISOString()
        : position.openedAt != null
        ? String(position.openedAt)
        : new Date().toISOString();
    const closedAt =
      position.closedAt instanceof Date
        ? position.closedAt.toISOString()
        : position.closedAt != null
        ? String(position.closedAt)
        : undefined;
    const leverageStr =
      typeof leverageValue === "number" && leverageValue > 0 ? toDecimalString(leverageValue, 2) : undefined;

    return {
      id: String(position.id),
      symbol: position.symbol,
      side: position.side as "LONG" | "SHORT",
      sizeUsd: toDecimalString(sizeUsd),
      amountUsd: toDecimalString(amountUsdValue, 2),
      qty: toDecimalString(qty),
      entryPrice: toDecimalString(entryPrice),
      currentPrice: currentPriceStr,
      pnlUsd: toDecimalString(pnlUsd),
      leverage: leverageStr,
      tpPrice,
      slPrice,
      status: position.status ?? "OPEN",
      openedAt,
      closedAt,
      userId: position.userId,
      orderId: position.orderId ?? undefined,
    };
  };

  startRiskWatcher({
    fetchOpenPositions: () => storage.getAllOpenPositions(),
    resolveLastPrice: getPaperLastPrice,
    intervalMs: 750,
    cacheTtlMs: 1000,
    onTrigger: async (position, trigger, executionPrice) => {
      try {
        const { updated, pnlUsd } = await closePositionAndRecord(position, executionPrice, 0);
        const label = trigger === "TP" ? "TP" : "SL";
        console.info(
          `[riskWatcher] closed ${position.symbol} ${position.side} via ${label} at ${toDecimalString(executionPrice)}`,
        );
        void telegramService.sendNotification(
          `Closed ${position.symbol} ${position.side} via ${label} at ${toDecimalString(executionPrice)} (PnL: $${toDecimalString(
            pnlUsd,
            2,
          )})`,
        );
        broadcast({ type: "position_closed", data: updated });
      } catch (error) {
        console.error(
          `[riskWatcher] failed to close ${position.symbol} ${position.side} via ${trigger}: ${(error as Error).message ?? error}`,
        );
      }
    },
  });


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
        demo: (user.email ?? "").toLowerCase() === DEMO_EMAIL,
        settings,
        serverTime: new Date().toISOString(),
      });
    } catch (error) {
      const fallback = {
        userId: LEGACY_DEMO_USER_ID,
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
        warning: "Failed to initialise session. Using demo defaults.",
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
      const normalizedSymbols = symbols?.map((value) => value.trim()).filter((value) => value.length > 0);
      const cacheKey = normalizedSymbols && normalizedSymbols.length > 0
        ? `market-data:${normalizedSymbols.sort().join(",")}`
        : "market-data:all";

      const { value } = await cached(cacheKey, MICRO_CACHE_TTL_MS, async () => {
        const data = await storage.getMarketData(normalizedSymbols);
        return Array.isArray(data) ? data : [];
      });

      res.json(value);
    } catch (error) {
      console.warn(`[market-data] fallback due to error: ${(error as Error).message ?? error}`);
      res.json([]);
    }
  });

  app.get("/api/market/24h", async (req, res) => {
    try {
      const symbolsParam = typeof req.query.symbols === "string" ? req.query.symbols : undefined;
      let symbols: string[] = [];

      if (symbolsParam) {
        symbols = symbolsParam
          .split(",")
          .map((value) => value.trim())
          .filter((value) => value.length > 0);
      } else {
        const pairs = await storage.getAllTradingPairs();
        symbols = pairs.map((pair) => pair.symbol);
      }

      const uniqueSymbols = Array.from(new Set(symbols.map((symbol) => symbol.trim()).filter(Boolean)));

      if (uniqueSymbols.length === 0) {
        return res.json({ items: [] });
      }

      const items = await get24hChangeForSymbols(uniqueSymbols);
      res.json({ items });
    } catch (error) {
      respondWithError(res, "GET /api/market/24h", error, "Failed to fetch 24h market change");
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

  app.get("/api/settings/account", async (_req, res) => {
    try {
      const { settings } = await ensureDefaultUser();
      const snapshot = getAccountSnapshot();
      let totalBalanceDecimal = decimalOrZero(settings.totalBalance ?? 0);
      if (snapshot && Number.isFinite(snapshot.totalBalance)) {
        totalBalanceDecimal = decimalOrZero(snapshot.totalBalance);
      }
      const totalBalance = totalBalanceDecimal.toDecimalPlaces(2, Decimal.ROUND_DOWN).toNumber();
      res.json({ totalBalance });
    } catch (error) {
      respondWithError(res, "GET /api/settings/account", error, "Failed to fetch account settings");
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

      if (settings.totalBalance != null) {
        const numeric = Number(settings.totalBalance);
        if (Number.isFinite(numeric)) {
          updateAccountSnapshot({ totalBalance: numeric });
        }
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
        : { userId: user.id, ...DEFAULT_USER_SETTINGS };

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

      if (patch.totalBalance != null) {
        const valueDecimal = decimalOrNull(patch.totalBalance);
        if (!valueDecimal || valueDecimal.lt(0)) {
          return res.status(400).json({ message: "Total balance must be a non-negative number" });
        }
        base.totalBalance = valueDecimal.toDecimalPlaces(2, Decimal.ROUND_DOWN).toFixed(2);
      }

      if (base.totalBalance == null && existing?.totalBalance != null) {
        base.totalBalance = existing.totalBalance;
      }

      base.userId = user.id;

      const result = await storage.upsertUserSettings(base);
      const responseBalanceDecimal = decimalOrZero(result.totalBalance ?? base.totalBalance ?? 0);
      const normalizedBalance = responseBalanceDecimal
        .toDecimalPlaces(2, Decimal.ROUND_DOWN)
        .toNumber();
      updateAccountSnapshot({ totalBalance: normalizedBalance });
      res.json({ totalBalance: normalizedBalance });
    } catch (error) {
      respondWithError(res, "PATCH /api/settings/account", error, "Failed to update account settings");
    }
  });

  app.get("/api/positions/open", async (req, res) => {
    try {
      const userId = await resolveUserId(req.query.userId);
      const cacheKey = userId ? `positions:open:${userId}` : "positions:open";
      const { value: positions } = await cached<OpenPositionResponse[]>(
        cacheKey,
        MICRO_CACHE_TTL_MS,
        async () => {
          const basePositions = await storage.getOpenPositions(userId);
          return basePositions.map((position) => buildOpenPositionResponse(position));
        },
      );

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
    const parsed = quickTradeRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const firstError = parsed.error.errors[0]?.message ?? "Invalid request";
      return res.status(400).json({ code: "BAD_REQUEST", message: firstError });
    }

    try {
      const payload = parsed.data;
      const symbol = payload.symbol.toUpperCase();
      const side = payload.side;
      const mode = payload.mode;

      const { user, settings } = await ensureDefaultUser();

      const lastPrice = getPaperLastPrice(symbol);
      const hasLivePrice = Number.isFinite(lastPrice) && typeof lastPrice === "number" && lastPrice > 0;

      if (!hasLivePrice) {
        void telegramService.sendNotification(
          "❌ Failed to open position: No market price available for the selected symbol",
        );
        return res.status(400).json({ message: "No market price available for the selected symbol" });
      }

      const priceDecimal = new Decimal(lastPrice as number);
      let qtyDecimal: Decimal | null = null;
      let amountUsdDecimal: Decimal | null = null;
      let requiredUsdDecimal: Decimal | null = null;

      if (mode === "QTY") {
        qtyDecimal = decimalOrNull(payload.qty);
        if (!qtyDecimal || qtyDecimal.lte(0)) {
          return res.status(400).json({ message: "Quantity must be greater than zero" });
        }
        amountUsdDecimal = qtyDecimal.times(priceDecimal);
        requiredUsdDecimal = amountUsdDecimal;
      } else {
        amountUsdDecimal = decimalOrNull(payload.usdtAmount);
        if (!amountUsdDecimal || amountUsdDecimal.lte(0)) {
          return res.status(400).json({ message: "USDT amount must be greater than zero" });
        }

        const tradingPair = await storage.getTradingPair(symbol);
        const filters = await binanceService.getSymbolFilters(symbol);
        const stepSize = filters?.stepSize ?? (tradingPair?.stepSize ? Number(tradingPair.stepSize) : undefined);
        const minQty = filters?.minQty ?? (tradingPair?.minQty ? Number(tradingPair.minQty) : undefined);
        const minNotional =
          filters?.minNotional ?? (tradingPair?.minNotional ? Number(tradingPair.minNotional) : undefined);

        try {
          const quantityResult = calculateQuantityFromUsd(
            amountUsdDecimal.toNumber(),
            priceDecimal.toNumber(),
            {
              stepSize,
              minQty,
              minNotional,
            },
          );
          qtyDecimal = new Decimal(quantityResult.quantity);
          amountUsdDecimal = qtyDecimal.times(priceDecimal);
        } catch (error) {
          if (error instanceof QuantityValidationError) {
            return res.status(400).json({ message: error.message });
          }
          return res.status(400).json({ message: "Failed to calculate order quantity" });
        }

        requiredUsdDecimal = amountUsdDecimal;
      }

      if (!qtyDecimal || qtyDecimal.lte(0)) {
        return res.status(400).json({ message: "Position size could not be determined" });
      }

      if (!requiredUsdDecimal || !requiredUsdDecimal.isFinite()) {
        requiredUsdDecimal = qtyDecimal.times(priceDecimal);
      }

      const openPositions = await storage.getAllOpenPositions();
      const { equity } = await computeEquitySnapshot(settings, openPositions);

      if (requiredUsdDecimal.gt(equity)) {
        return res.status(400).json({ code: "INSUFFICIENT_EQUITY", message: "Insufficient equity" });
      }

      const qtyStr = formatDecimal(qtyDecimal, 8);
      const orderQty = Number(qtyStr);
      if (!Number.isFinite(orderQty) || orderQty <= 0) {
        return res.status(400).json({ message: "Order quantity is invalid" });
      }

      const brokerSide = side === "LONG" ? "BUY" : "SELL";
      const order = await broker.placeOrder({
        symbol,
        side: brokerSide,
        type: "MARKET",
        qty: orderQty,
      });

      if (!order) {
        void telegramService.sendNotification("❌ Failed to open position: Order execution failed");
        return res.status(400).json({ message: "Failed to execute trade" });
      }

      const entryFill = decimalOrNull(order.fills?.[0]?.price) ?? priceDecimal;
      const executedAmountUsd = qtyDecimal.times(entryFill);
      const amountUsdStr = formatDecimal(executedAmountUsd, 2);
      const entryPriceStr = formatDecimal(entryFill, 8);

      const leverageDecimal = decimalOrNull(payload.leverage ?? settings.defaultLeverage ?? 1);
      const leverageStr = leverageDecimal ? formatDecimal(leverageDecimal, 2) : undefined;

      const defaults = computeDefaultTargets(side, entryFill.toNumber(), settings);

      const providedTp = payload.tp_price === null ? null : decimalOrNull(payload.tp_price);
      const providedSl = payload.sl_price === null ? null : decimalOrNull(payload.sl_price);

      if (
        providedTp &&
        ((side === "LONG" && providedTp.lte(entryFill)) || (side === "SHORT" && providedTp.gte(entryFill)))
      ) {
        return res
          .status(400)
          .json({ message: "Take profit must be beyond the entry price for the selected side" });
      }

      if (
        providedSl &&
        ((side === "LONG" && providedSl.gte(entryFill)) || (side === "SHORT" && providedSl.lte(entryFill)))
      ) {
        return res
          .status(400)
          .json({ message: "Stop loss must be beyond the entry price for the selected side" });
      }

      const takeProfitPrice =
        providedTp === null
          ? undefined
          : providedTp
          ? formatDecimal(providedTp, 8)
          : defaults.takeProfit ?? undefined;
      const stopLossPrice =
        providedSl === null
          ? undefined
          : providedSl
          ? formatDecimal(providedSl, 8)
          : defaults.stopLoss ?? undefined;

      const positionToSave = insertPositionSchema.parse({
        userId: user.id,
        symbol,
        side,
        entryPrice: entryPriceStr,
        currentPrice: entryPriceStr,
        size: amountUsdStr,
        qty: qtyStr,
        amountUsd: amountUsdStr,
        leverage: leverageStr,
        takeProfit: takeProfitPrice,
        stopLoss: stopLossPrice,
        tpPrice: takeProfitPrice,
        slPrice: stopLossPrice,
        status: "OPEN",
      });

      const result = await storage.createPosition({
        ...positionToSave,
        orderId: order.orderId,
      });

      clearCacheKey("positions:open");
      clearCacheKey(`positions:open:${user.id}`);

      console.info(
        `[trade] opened ${result.symbol} ${result.side} qty=${result.qty ?? result.size} entry=${result.entryPrice}`,
      );

      await telegramService.sendTradeNotification({
        action: "opened",
        symbol: result.symbol,
        side: result.side,
        size: result.qty ?? result.size,
        price: result.entryPrice,
        stopLoss: result.stopLoss ?? result.slPrice ?? undefined,
        takeProfit: result.takeProfit ?? result.tpPrice ?? undefined,
      });

      broadcast({ type: "position_opened", data: result });
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void telegramService.sendNotification(`❌ Failed to open position: ${message}`);
      respondWithError(res, "POST /api/positions", error, "Failed to create position");
    }
  });

  app.patch("/api/positions/:id/risk", async (req, res) => {
    try {
      const { id } = req.params;
      const payload = riskPatchSchema.parse(req.body ?? {});
      const position = await storage.getPositionById(id);
      if (!position || position.status !== "OPEN") {
        return res.status(404).json({ message: "Position not found" });
      }

      const entryNumeric = parseNumeric(position.entryPrice);
      if (!Number.isFinite(entryNumeric) || (entryNumeric as number) <= 0) {
        return res.status(400).json({ message: "Entry price unavailable for risk update" });
      }

      const parseTargetField = (value: unknown, label: string): { provided: boolean; value: number | null } => {
        if (value === undefined) {
          return { provided: false, value: null };
        }
        if (value === null) {
          return { provided: true, value: null };
        }
        if (typeof value === "string" && value.trim().length === 0) {
          return { provided: true, value: null };
        }
        const numeric = parseNumeric(value);
        if (!Number.isFinite(numeric) || (numeric as number) <= 0) {
          throw new Error(`${label} must be greater than zero`);
        }
        return { provided: true, value: numeric as number };
      };

      let tpInput;
      let slInput;
      try {
        tpInput = parseTargetField(payload.tpPrice, "TP price");
        slInput = parseTargetField(payload.slPrice, "SL price");
      } catch (parseError) {
        return res.status(400).json({ message: (parseError as Error).message });
      }

      if (!tpInput.provided && !slInput.provided) {
        return res.json(buildOpenPositionResponse(position));
      }

      const entryPrice = entryNumeric as number;
      const side = String(position.side ?? "").toUpperCase();

      if (tpInput.value != null) {
        if (side === "LONG" && tpInput.value <= entryPrice) {
          return res.status(400).json({ message: "Take profit must be above entry price for LONG positions" });
        }
        if (side === "SHORT" && tpInput.value >= entryPrice) {
          return res.status(400).json({ message: "Take profit must be below entry price for SHORT positions" });
        }
      }

      if (slInput.value != null) {
        if (side === "LONG" && slInput.value >= entryPrice) {
          return res.status(400).json({ message: "Stop loss must be below entry price for LONG positions" });
        }
        if (side === "SHORT" && slInput.value <= entryPrice) {
          return res.status(400).json({ message: "Stop loss must be above entry price for SHORT positions" });
        }
      }

      const updates: Partial<typeof positions.$inferInsert> = {};
      if (tpInput.provided) {
        updates.tpPrice = tpInput.value != null ? toDecimalString(tpInput.value) : null;
        updates.takeProfit = updates.tpPrice;
      }
      if (slInput.provided) {
        updates.slPrice = slInput.value != null ? toDecimalString(slInput.value) : null;
        updates.stopLoss = updates.slPrice;
      }

      const updated = await storage.updatePosition(id, updates);
      clearCacheKey("positions:open");
      clearCacheKey(`positions:open:${position.userId}`);
      broadcast({ type: "position_updated", data: updated });
      res.json(buildOpenPositionResponse(updated));
    } catch (error) {
      respondWithError(res, "PATCH /api/positions/:id/risk", error, "Failed to update risk targets");
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
        void telegramService.sendNotification("❌ Failed to close position: Position not found");
        return res.status(404).json({ message: "Position not found" });
      }

      const marketPrice = getPaperLastPrice(position.symbol);
      const fallbackPrice = parseNumeric(position.currentPrice) ?? parseNumeric(position.entryPrice) ?? 0;
      const exitPrice = marketPrice ?? fallbackPrice;

      const { updated } = await closePositionAndRecord(position, exitPrice, 0);

      broadcast({ type: "position_closed", data: updated });
      res.json(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void telegramService.sendNotification(`❌ Failed to close position: ${message}`);
      respondWithError(res, "DELETE /api/positions/:id", error, "Failed to close position");
    }
  });

  app.post("/api/positions/:userId/close-all", async (req, res) => {
    try {
      const userId = await resolveUserId(req.params.userId);
      const openPositions = await storage.getOpenPositions(userId);

      const closed: Position[] = [];
      for (const position of openPositions) {
        const marketPrice = getPaperLastPrice(position.symbol);
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
      const message = error instanceof Error ? error.message : String(error);
      void telegramService.sendNotification(`❌ Failed to close all positions: ${message}`);
      respondWithError(res, "POST /api/positions/:userId/close-all", error, "Failed to close all positions");
    }
  });

  app.post("/api/trades/close", async (req, res) => {
    try {
      const payload = tradeCloseSchema.parse(req.body ?? {});
      const position = await storage.getPositionById(payload.positionId);
      if (!position) {
        void telegramService.sendNotification("❌ Failed to close trade: Position not found");
        return res.status(404).json({ message: "Position not found" });
      }

      const providedPrice = parseNumeric(payload.exitPrice);
      const marketPrice = getPaperLastPrice(position.symbol);
      const fallbackPrice = parseNumeric(position.currentPrice) ?? parseNumeric(position.entryPrice) ?? 0;
      const exitPrice = providedPrice ?? marketPrice ?? fallbackPrice;
      const feeUsd = parseNumeric(payload.feeUsd) ?? 0;

      const { closedRecord, updated } = await closePositionAndRecord(position, exitPrice, feeUsd);

      broadcast({ type: "position_closed", data: updated });
      res.json(closedRecord);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void telegramService.sendNotification(`❌ Failed to close trade: ${message}`);
      respondWithError(res, "POST /api/trades/close", error, "Failed to close trade");
    }
  });

  app.get("/api/stats/summary", async (_req, res) => {
  const fallback: StatsSummaryResponse = {
      totalTrades: 0,
      winRate: 0,
      avgRR: 0,
      totalPnl: 0,
      dailyPnl: 0,
      last30dPnl: 0,
      balance: 0,
      equity: 0,
      openPnL: 0,
      totalBalance: 0,
    };

    try {
      const { settings } = await ensureDefaultUser();
      const [closedRows, accountRows, openPositionRows] = await Promise.all([
        db.select().from(closedPositions),
        db.select().from(paperAccounts).limit(1),
        storage.getAllOpenPositions(),
      ]);
      const totalBalanceSetting = Number(settings.totalBalance ?? 0);

      const computeClosedPnl = (row: (typeof closedRows)[number]) => {
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

      const closedWithPnl = closedRows.map((row) => ({ ...row, computedPnlUsd: computeClosedPnl(row) }));

      const totalTrades = closedWithPnl.length;
      const totalPnl = closedWithPnl.reduce((sum, row) => sum + row.computedPnlUsd, 0);
      const winningTrades = closedWithPnl.filter((row) => row.computedPnlUsd > 0).length;
      const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

      let rewardSum = 0;
      let rewardCount = 0;
      for (const row of closedWithPnl) {
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
      const last30dPnl = closedWithPnl
        .filter((row) => row.closedAt && new Date(row.closedAt) >= cutoff)
        .reduce((sum, row) => sum + row.computedPnlUsd, 0);

      const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const dailyPnl = closedWithPnl
        .filter((row) => row.closedAt && new Date(row.closedAt) >= cutoff24h)
        .reduce((sum, row) => sum + row.computedPnlUsd, 0);

      const snapshot = getAccountSnapshot();
      const fallbackBalance = parseNumeric(accountRows[0]?.balance);
      let totalBalanceDecimal = decimalOrZero(totalBalanceSetting);
      if (snapshot && Number.isFinite(snapshot.totalBalance)) {
        totalBalanceDecimal = decimalOrZero(snapshot.totalBalance).toDecimalPlaces(2);
      } else if (Number.isFinite(fallbackBalance ?? NaN)) {
        totalBalanceDecimal = decimalOrZero(fallbackBalance as number).toDecimalPlaces(2);
      }

      const { openPnL: openPnLDecimal } = await computeOpenMetrics(openPositionRows);
      const sanitizedOpenPnL = openPnLDecimal.isFinite() ? openPnLDecimal : new Decimal(0);
      const equityDecimal = totalBalanceDecimal.plus(sanitizedOpenPnL);

      const balance = totalBalanceDecimal.toDecimalPlaces(2, Decimal.ROUND_DOWN).toNumber();
      const openPnL = sanitizedOpenPnL.toDecimalPlaces(2, Decimal.ROUND_DOWN).toNumber();
      const equity = equityDecimal.toDecimalPlaces(2, Decimal.ROUND_DOWN).toNumber();

      const payload: StatsSummaryResponse = {
        totalTrades,
        winRate,
        avgRR: Number.isFinite(avgReward) ? avgReward : 0,
        totalPnl,
        dailyPnl,
        last30dPnl,
        balance,
        equity,
        openPnL,
        totalBalance: balance,
      };

      updateAccountSnapshot({ totalBalance: balance, equity, openPnL });

      res.json(payload);
    } catch (error) {
      console.warn(`[stats] summary fallback due to error: ${(error as Error).message ?? error}`);
      res.json(fallback);
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
      const type = resolveIndicatorType(payload.name, payload.type);
      const result = await storage.createIndicatorConfig({
        userId,
        name: payload.name,
        payload: payload.payload,
        type,
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

      const { user } = await ensureDefaultUser();
      const [pairs, pairTimeframesRows] = await Promise.all([
        storage.getAllTradingPairs(),
        storage.getUserPairSettings(user.id),
      ]);

      const timeframeMap = new Map<string, string[]>();
      pairTimeframesRows.forEach((row) => {
        const list = timeframeMap.get(row.symbol) ?? [];
        row.activeTimeframes?.forEach((tf) => list.push(tf));
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

      const { user } = await ensureDefaultUser();
      const pairTimeframesRows = await storage.getUserPairSettings(user.id, symbol);
      const timeframeMap = new Map<string, string[]>();
      pairTimeframesRows.forEach((row) => {
        const list = timeframeMap.get(row.symbol) ?? [];
        row.activeTimeframes?.forEach((tf) => list.push(tf));
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

  app.get("/api/pairs/:symbol/settings", async (req, res) => {
    try {
      const { symbol: rawSymbol } = req.params;
      const symbol = rawSymbol.toUpperCase();
      const { user } = await ensureDefaultUser();
      const rows = await storage.getUserPairSettings(user.id, symbol);
      const activeTimeframes = rows[0]?.activeTimeframes ?? [];
      res.json({ symbol, activeTimeframes });
    } catch (error) {
      respondWithError(res, "GET /api/pairs/:symbol/settings", error, "Failed to fetch pair settings");
    }
  });

  app.patch("/api/pairs/:symbol/settings", async (req, res) => {
    const { symbol: rawSymbol } = req.params;
    const symbol = rawSymbol.toUpperCase();
    const parsed = pairSettingsPayloadSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const firstError = parsed.error.errors[0]?.message ?? "Invalid request";
      return res.status(400).json({ code: "BAD_REQUEST", message: firstError });
    }

    try {
      const { user } = await ensureDefaultUser();
      const activeTimeframes = normalizeActiveTimeframes(parsed.data.activeTimeframes);

      const result = await storage.upsertUserPairSettings({
        userId: user.id,
        symbol,
        activeTimeframes,
      });

      res.json({ symbol: result.symbol, activeTimeframes: result.activeTimeframes ?? [] });
    } catch (error) {
      respondWithError(res, "PATCH /api/pairs/:symbol/settings", error, "Failed to save pair settings");
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
