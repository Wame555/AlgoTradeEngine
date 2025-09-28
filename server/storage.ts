import { randomUUID } from "crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import {
  users,
  userSettings,
  indicatorConfigs,
  positions,
  signals,
  userPairSettings,
  marketData,
  tradingPairs,
  closedPositions,
  type TradingPair,
  type User,
  type UserSettings,
  type InsertUserSettings,
  type IndicatorConfig,
  type InsertIndicatorConfig,
  type Position,
  type InsertPosition,
  type Signal,
  type InsertSignal,
  type UserPairSetting,
  type MarketData,
  type ClosedPosition,
  type InsertClosedPosition,
} from "@shared/schema";

import { db } from "./db";
import * as positionsRepo from "./db/positionsRepo";
import { resolveIndicatorType } from "./utils/indicatorConfigs";

export type InsertUser = Omit<User, "id" | "createdAt"> & { password?: string };
export type InsertUserPairSetting = { userId: string; symbol: string; activeTimeframes: string[] };

export type UserSettingsUpsertInput = Partial<InsertUserSettings> & { userId: string };

type MarketDataInsert = typeof marketData.$inferInsert;

export type MarketDataUpsertInput = {
  symbol: MarketDataInsert["symbol"];
  timeframe: MarketDataInsert["timeframe"];
  ts: MarketDataInsert["ts"];
} & Partial<Omit<MarketDataInsert, "id" | "symbol" | "timeframe" | "ts">>;

export interface ClosedPositionSummary extends ClosedPosition {
  pnlPct: number;
}

export interface ClosedPositionQueryOptions {
  symbol?: string;
  limit?: number;
  offset?: number;
}

const DEFAULT_INDICATOR_CONFIGS: Array<{ name: string; type: string; payload: Record<string, unknown> }> = [
  { name: "RSI", type: "RSI", payload: { length: 14 } },
  { name: "EMA Cross", type: "EMA", payload: { fast: 50, slow: 200 } },
  { name: "FVG", type: "FVG", payload: { lookback: 100, threshold: 0.0025 } },
];

type UserSettingsInsert = typeof userSettings.$inferInsert;

function pruneUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined),
  ) as Partial<T>;
}

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  getUserSettings(userId: string): Promise<UserSettings | undefined>;
  upsertUserSettings(settings: UserSettingsUpsertInput): Promise<UserSettings>;

  getAllTradingPairs(): Promise<TradingPair[]>;
  getTradingPair(symbol: string): Promise<TradingPair | undefined>;

  getIndicatorConfigs(userId: string): Promise<IndicatorConfig[]>;
  createIndicatorConfig(config: InsertIndicatorConfig): Promise<IndicatorConfig>;
  deleteIndicatorConfig(id: string, userId: string): Promise<void>;
  deleteIndicatorConfigsForUser(userId: string): Promise<void>;
  ensureIndicatorConfigsSeed(userId: string): Promise<void>;

  getOpenPositions(userId: string): Promise<Position[]>;
  getAllOpenPositions(): Promise<Position[]>;
  getPositionById(id: string): Promise<Position | undefined>;
  getPositionByRequestId(requestId: string): Promise<Position | undefined>;
  createPosition(position: InsertPosition): Promise<Position>;
  updatePosition(id: string, updates: Partial<Position>): Promise<Position>;
  closePosition(
    id: string,
    updates?: { closePrice?: string; pnl?: string },
  ): Promise<Position>;
  closeAllUserPositions(
    userId: string,
    computeUpdates?: (position: Position) => { closePrice?: string; pnl?: string },
  ): Promise<Position[]>;

  getClosedPositions(
    userId: string,
    options?: ClosedPositionQueryOptions,
  ): Promise<ClosedPositionSummary[]>;
  insertClosedPosition(data: InsertClosedPosition): Promise<ClosedPosition>;
  deleteAllClosedPositions(): Promise<void>;

  getRecentSignals(limit?: number): Promise<Signal[]>;
  getSignalsBySymbol(symbol: string, limit?: number): Promise<Signal[]>;
  createSignal(signal: InsertSignal): Promise<Signal>;

  getUserPairSettings(userId: string, symbol?: string): Promise<UserPairSetting[]>;
  upsertUserPairSettings(setting: InsertUserPairSetting): Promise<UserPairSetting>;

  getMarketData(symbols?: string[]): Promise<MarketData[]>;
  updateMarketData(data: MarketDataUpsertInput): Promise<void>;
}

function mapPositionRow(row: Record<string, any>): Position {
  const qtyValue = row.qty ?? row.size ?? undefined;
  const amountUsdValue = row.amount_usd ?? row.size ?? undefined;
  return {
    id: row.id,
    userId: row.user_id,
    symbol: row.symbol,
    side: row.side,
    size: row.size,
    qty: qtyValue ?? undefined,
    amountUsd: amountUsdValue ?? undefined,
    leverage: row.leverage ?? undefined,
    entryPrice: row.entry_price,
    currentPrice: row.current_price ?? undefined,
    pnl: row.pnl ?? undefined,
    stopLoss: row.stop_loss ?? undefined,
    takeProfit: row.take_profit ?? undefined,
    tpPrice: row.tp_price ?? undefined,
    slPrice: row.sl_price ?? undefined,
    trailingStopPercent: row.trailing_stop_percent ?? undefined,
    status: row.status,
    orderId: row.order_id ?? undefined,
    requestId: row.request_id ?? undefined,
    source: row.source ?? null,
    orderType: row.order_type ?? null,
    price: row.price ?? null,
    quantity: row.quantity ?? null,
    openedAt: row.opened_at,
    updatedAt: row.updated_at ?? undefined,
    closedAt: row.closed_at ?? undefined,
  };
}

function mapUserPairSettingRow(row: Record<string, any>): UserPairSetting {
  return {
    id: row.id,
    userId: row.user_id,
    symbol: row.symbol,
    activeTimeframes: Array.isArray(row.active_timeframes) ? [...row.active_timeframes] : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const inserted = await db
      .insert(users)
      .values({ ...insertUser, id })
      .onConflictDoNothing({ target: users.username })
      .returning();

    if (inserted.length > 0) {
      return inserted[0]!;
    }

    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.username, insertUser.username))
      .limit(1);

    if (!existing) {
      throw new Error(`Failed to create or retrieve user with username "${insertUser.username}"`);
    }

    return existing;
  }

  async getUserSettings(userId: string): Promise<UserSettings | undefined> {
    const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
    return settings;
  }

  async upsertUserSettings(settings: UserSettingsUpsertInput): Promise<UserSettings> {
    const now = new Date();

    const columnMap: Record<keyof UserSettingsInsert, string> = {
      id: "id",
      userId: "user_id",
      telegramBotToken: "telegram_bot_token",
      telegramChatId: "telegram_chat_id",
      binanceApiKey: "binance_api_key",
      binanceApiSecret: "binance_api_secret",
      isTestnet: "is_testnet",
      defaultLeverage: "default_leverage",
      riskPercent: "risk_percent",
      createdAt: "created_at",
      updatedAt: "updated_at",
      demoEnabled: "demo_enabled",
      defaultTpPct: "default_tp_pct",
      defaultSlPct: "default_sl_pct",
      totalBalance: "total_balance",
      initialBalance: "initial_balance",
    };

    const insertBase = pruneUndefined({
      ...settings,
      userId: settings.userId,
      updatedAt: now,
    }) as Partial<UserSettingsInsert>;

    if (!insertBase.userId) {
      throw new Error("userId is required for user settings upsert");
    }

    const insertEntries = Object.entries(insertBase) as Array<[keyof UserSettingsInsert, unknown]>;

    const updatePayload = pruneUndefined({ ...settings }) as Partial<UserSettingsInsert>;
    delete (updatePayload as Record<string, unknown>).userId;
    delete (updatePayload as Record<string, unknown>).createdAt;

    const insertColumnsSql = sql.join(
      insertEntries.map(([key]) => sql.identifier(columnMap[key])),
      sql`, `,
    );
    const insertValuesSql = sql.join(
      insertEntries.map(([, value]) => sql`${value}`),
      sql`, `,
    );

    const updateAssignments = Object.entries(updatePayload)
      .filter(([key]) => key !== "userId")
      .map(([key, value]) => sql`${sql.identifier(columnMap[key as keyof UserSettingsInsert])} = ${value}`);
    updateAssignments.push(sql`${sql.identifier(columnMap.updatedAt)} = ${now}`);
    const updateSetSql = sql.join(updateAssignments, sql`, `);

    try {
      const result = await db.execute<UserSettings>(
        sql`
          INSERT INTO public.user_settings (${insertColumnsSql})
          VALUES (${insertValuesSql})
          ON CONFLICT ON CONSTRAINT user_settings_user_id_uniq
          DO UPDATE SET ${updateSetSql}
          RETURNING *;
        `,
      );

      return result.rows[0]!;
    } catch (error) {
      console.warn("[storage.upsertUserSettings] failed", {
        insertKeys: insertEntries.map(([key]) => key),
        updateAssignmentsCount: updateAssignments.length,
      });
      throw error;
    }
  }

  async getAllTradingPairs(): Promise<TradingPair[]> {
    return db.select().from(tradingPairs).where(eq(tradingPairs.isActive, true));
  }

  async getTradingPair(symbol: string): Promise<TradingPair | undefined> {
    const [pair] = await db.select().from(tradingPairs).where(eq(tradingPairs.symbol, symbol));
    return pair;
  }

  async getIndicatorConfigs(userId: string): Promise<IndicatorConfig[]> {
    return db
      .select()
      .from(indicatorConfigs)
      .where(eq(indicatorConfigs.userId, userId))
      .orderBy(desc(indicatorConfigs.createdAt));
  }

  async createIndicatorConfig(config: InsertIndicatorConfig): Promise<IndicatorConfig> {
    const id = randomUUID();
    const resolvedType = resolveIndicatorType(config.name, config.type);
    const [row] = await db
      .insert(indicatorConfigs)
      .values({ ...config, id, type: resolvedType })
      .onConflictDoUpdate({
        target: [indicatorConfigs.userId, indicatorConfigs.name],
        set: {
          payload: config.payload,
          type: resolvedType,
          createdAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  async deleteIndicatorConfig(id: string, userId: string): Promise<void> {
    await db.delete(indicatorConfigs).where(and(eq(indicatorConfigs.id, id), eq(indicatorConfigs.userId, userId)));
  }

  async deleteIndicatorConfigsForUser(userId: string): Promise<void> {
    await db.delete(indicatorConfigs).where(eq(indicatorConfigs.userId, userId));
  }

  async ensureIndicatorConfigsSeed(userId: string): Promise<void> {
    const existing = await db
      .select({ count: sql<number>`count(*)` })
      .from(indicatorConfigs)
      .where(eq(indicatorConfigs.userId, userId));

    if (Number(existing[0]?.count ?? 0) > 0) {
      return;
    }

    for (const config of DEFAULT_INDICATOR_CONFIGS) {
      const type = resolveIndicatorType(config.name, config.type);
      await db
        .insert(indicatorConfigs)
        .values({
          id: randomUUID(),
          userId,
          name: config.name,
          payload: config.payload,
          type,
        })
        .onConflictDoNothing({ target: [indicatorConfigs.userId, indicatorConfigs.name] });
    }
  }

  async getOpenPositions(userId: string): Promise<Position[]> {
    const rows = await positionsRepo.selectDedupedOpenPositions(userId);
    return rows.map((row) => mapPositionRow(row));
  }


  async getAllOpenPositions(): Promise<Position[]> {
    const rows = await positionsRepo.selectAllOpenPositions();
    return rows.map((row) => mapPositionRow(row));
  }

  async getPositionById(id: string): Promise<Position | undefined> {
    const row = await positionsRepo.selectPositionById(id);
    return row ? mapPositionRow(row) : undefined;
  }

  async getPositionByRequestId(requestId: string): Promise<Position | undefined> {
    if (!requestId) {
      return undefined;
    }
    const row = await positionsRepo.selectPositionByRequestId(requestId);
    return row ? mapPositionRow(row) : undefined;
  }

  async createPosition(position: InsertPosition): Promise<Position> {
    const id = randomUUID();
    const timestamp = new Date();
    const row = await positionsRepo.insertPosition({ ...position, id, updatedAt: timestamp });
    return mapPositionRow(row);
  }

  async updatePosition(id: string, updates: Partial<Position>): Promise<Position> {
    const payload = {
      ...updates,
      updatedAt: new Date(),
    } as positionsRepo.UpdatePositionInput;
    const row = await positionsRepo.updatePosition(id, payload);
    if (!row) {
      throw new Error(`Position ${id} not found`);
    }
    return mapPositionRow(row);
  }

  async closePosition(
    id: string,
    updates: { closePrice?: string; pnl?: string } = {},
  ): Promise<Position> {
    const updateData: positionsRepo.UpdatePositionInput = {
      status: "CLOSED",
      closedAt: new Date(),
      updatedAt: new Date(),
    };

    if (updates.closePrice !== undefined) {
      updateData.currentPrice = updates.closePrice;
    }

    if (updates.pnl !== undefined) {
      updateData.pnl = updates.pnl;
    }

    const row = await positionsRepo.updatePosition(id, updateData);
    if (!row) {
      throw new Error(`Position ${id} not found`);
    }
    return mapPositionRow(row);
  }

  async closeAllUserPositions(
    userId: string,
    computeUpdates?: (position: Position) => { closePrice?: string; pnl?: string },
  ): Promise<Position[]> {
    const openRows = await positionsRepo.selectOpenPositionsByUser(userId);
    const results: Position[] = [];

    for (const row of openRows) {
      const position = mapPositionRow(row);
      const updates = computeUpdates ? computeUpdates(position) : {};
      const updateData: positionsRepo.UpdatePositionInput = {
        status: "CLOSED",
        closedAt: new Date(),
        updatedAt: new Date(),
      };

      if (updates?.closePrice !== undefined) {
        updateData.currentPrice = updates.closePrice;
      }

      if (updates?.pnl !== undefined) {
        updateData.pnl = updates.pnl;
      }

      const updatedRow = await positionsRepo.updatePosition(position.id, updateData);
      if (updatedRow) {
        results.push(mapPositionRow(updatedRow));
      }
    }

    return results;
  }

  async getClosedPositions(
    userId: string,
    options: ClosedPositionQueryOptions = {},
  ): Promise<ClosedPositionSummary[]> {
    const limit = options.limit && options.limit > 0 ? Math.min(options.limit, 200) : 50;
    const offset = options.offset && options.offset >= 0 ? options.offset : 0;

    const whereClauses = [eq(closedPositions.userId, userId)];
    if (options.symbol) {
      whereClauses.push(eq(closedPositions.symbol, options.symbol));
    }

    const pnlExpression = sql<string>`(
      CASE
        WHEN ${closedPositions.side} = 'LONG' THEN (${closedPositions.exitPrice} - ${closedPositions.entryPrice}) * ${closedPositions.size}
        ELSE (${closedPositions.entryPrice} - ${closedPositions.exitPrice}) * ${closedPositions.size}
      END
    ) - COALESCE(${closedPositions.feeUsd}, 0)`;

    const pnlPctExpression = sql<number>`CASE
      WHEN ${closedPositions.entryPrice} = 0 THEN 0
      WHEN ${closedPositions.side} = 'LONG' THEN ((${closedPositions.exitPrice} - ${closedPositions.entryPrice}) / ${closedPositions.entryPrice}) * 100
      ELSE ((${closedPositions.entryPrice} - ${closedPositions.exitPrice}) / ${closedPositions.entryPrice}) * 100
    END`;

    const rows = await db
      .select({
        id: closedPositions.id,
        userId: closedPositions.userId,
        symbol: closedPositions.symbol,
        side: closedPositions.side,
        size: closedPositions.size,
        entryPrice: closedPositions.entryPrice,
        exitPrice: closedPositions.exitPrice,
        feeUsd: closedPositions.feeUsd,
        pnlUsd: pnlExpression,
        pnlPct: pnlPctExpression,
        openedAt: closedPositions.openedAt,
        closedAt: closedPositions.closedAt,
      })
      .from(closedPositions)
      .where(and(...whereClauses))
      .orderBy(desc(closedPositions.closedAt))
      .limit(limit)
      .offset(offset);

    return rows.map((row) => {
      const pnlUsdValue = row.pnlUsd as unknown;
      return {
        ...row,
        pnlUsd: typeof pnlUsdValue === "number" ? pnlUsdValue.toString() : String(pnlUsdValue ?? "0"),
        pnlPct: Number((row.pnlPct as unknown) ?? 0),
      };
    });
  }

  async insertClosedPosition(data: InsertClosedPosition): Promise<ClosedPosition> {
    const id = randomUUID();
    const [row] = await db.insert(closedPositions).values({ ...data, id }).returning();
    return row;
  }

  async deleteAllClosedPositions(): Promise<void> {
    await db.delete(closedPositions);
  }

  async getRecentSignals(limit: number = 50): Promise<Signal[]> {
    return db.select().from(signals).orderBy(desc(signals.createdAt)).limit(limit);
  }

  async getSignalsBySymbol(symbol: string, limit: number = 20): Promise<Signal[]> {
    return db
      .select()
      .from(signals)
      .where(eq(signals.symbol, symbol))
      .orderBy(desc(signals.createdAt))
      .limit(limit);
  }

  async createSignal(signal: InsertSignal): Promise<Signal> {
    const id = randomUUID();
    const [result] = await db.insert(signals).values({ ...signal, id }).returning();
    return result;
  }

  async getUserPairSettings(userId: string, symbol?: string): Promise<UserPairSetting[]> {
    if (symbol) {
      return db
        .select()
        .from(userPairSettings)
        .where(and(eq(userPairSettings.userId, userId), eq(userPairSettings.symbol, symbol)));
    }

    return db
      .select()
      .from(userPairSettings)
      .where(eq(userPairSettings.userId, userId));
  }

  async upsertUserPairSettings(setting: InsertUserPairSetting): Promise<UserPairSetting> {
    const active = Array.isArray(setting.activeTimeframes)
      ? setting.activeTimeframes.filter((value): value is string => typeof value === "string" && value.length > 0)
      : [];

    const result = await db.execute(sql`
      INSERT INTO public."user_pair_settings" ("user_id", "symbol", "active_timeframes", "updated_at")
      VALUES (${setting.userId}, ${setting.symbol}, ${active}, NOW())
      ON CONFLICT ON CONSTRAINT user_pair_settings_user_symbol_uniq
      DO UPDATE SET "active_timeframes" = EXCLUDED."active_timeframes", "updated_at" = NOW()
      RETURNING *;
    `);

    const row = result.rows[0];
    if (!row) {
      throw new Error("Failed to upsert user pair settings");
    }

    return mapUserPairSettingRow(row);
  }

  async getMarketData(symbols?: string[]): Promise<MarketData[]> {
    if (symbols && symbols.length > 0) {
      return db
        .select()
        .from(marketData)
        .where(inArray(marketData.symbol, symbols))
        .orderBy(marketData.symbol);
    }

    return db.select().from(marketData).orderBy(marketData.symbol);
  }

  async updateMarketData(data: MarketDataUpsertInput): Promise<void> {
    const columnMap = {
      symbol: "symbol",
      timeframe: "timeframe",
      ts: "ts",
      open: "open",
      high: "high",
      low: "low",
      close: "close",
      volume: "volume",
    } as const satisfies Record<keyof Omit<MarketDataInsert, "id">, string>;

    type ColumnKey = keyof typeof columnMap;

    const basePayload = pruneUndefined({
      symbol: data.symbol,
      timeframe: data.timeframe,
      ts: data.ts,
      open: data.open,
      high: data.high,
      low: data.low,
      close: data.close,
      volume: data.volume,
    }) as Partial<Omit<MarketDataInsert, "id">>;

    const entries = Object.entries(basePayload) as Array<[ColumnKey, unknown]>;

    if (entries.length === 0) {
      return;
    }

    const insertColumnsSql = sql.join(
      entries.map(([key]) => sql.identifier(columnMap[key])),
      sql`, `,
    );
    const insertValuesSql = sql.join(entries.map(([, value]) => sql`${value}`), sql`, `);

    const updateSqlFragments = entries
      .filter(([key]) => key !== "symbol" && key !== "timeframe" && key !== "ts")
      .map(([key]) =>
        sql`${sql.identifier(columnMap[key])} = EXCLUDED.${sql.identifier(columnMap[key])}`,
      );

    if (updateSqlFragments.length === 0) {
      await db.execute(
        sql`
          INSERT INTO public."market_data" (${insertColumnsSql})
          VALUES (${insertValuesSql})
          ON CONFLICT ON CONSTRAINT market_data_symbol_timeframe_ts_uniq
          DO NOTHING;
        `,
      );
      return;
    }

    await db.execute(
      sql`
        INSERT INTO public."market_data" (${insertColumnsSql})
        VALUES (${insertValuesSql})
        ON CONFLICT ON CONSTRAINT market_data_symbol_timeframe_ts_uniq
        DO UPDATE SET ${sql.join(updateSqlFragments, sql`, `)};
      `,
    );
  }
}

export const storage = new DatabaseStorage();
