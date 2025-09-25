import { randomUUID } from "crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import {
  users,
  userSettings,
  indicatorConfigs,
  positions,
  signals,
  pairTimeframes,
  marketData,
  tradingPairs,
  closedPositions,
  type TradingPair,
  type User,
  type InsertUser,
  type UserSettings,
  type InsertUserSettings,
  type IndicatorConfig,
  type InsertIndicatorConfig,
  type Position,
  type InsertPosition,
  type Signal,
  type InsertSignal,
  type PairTimeframe,
  type MarketData,
  type ClosedPosition,
  type InsertClosedPosition,
} from "@shared/schema";

import { db } from "./db";

export interface ClosedPositionSummary extends ClosedPosition {
  pnlPct: number;
}

export interface ClosedPositionQueryOptions {
  symbol?: string;
  limit?: number;
  offset?: number;
}

const DEFAULT_INDICATOR_CONFIGS: Array<{ name: string; payload: Record<string, unknown> }> = [
  { name: "RSI", payload: { length: 14 } },
  { name: "EMA Cross", payload: { fast: 50, slow: 200 } },
  { name: "FVG", payload: { lookback: 100, threshold: 0.0025 } },
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
  upsertUserSettings(settings: InsertUserSettings): Promise<UserSettings>;

  getAllTradingPairs(): Promise<TradingPair[]>;
  getTradingPair(symbol: string): Promise<TradingPair | undefined>;

  getIndicatorConfigs(userId: string): Promise<IndicatorConfig[]>;
  createIndicatorConfig(config: InsertIndicatorConfig): Promise<IndicatorConfig>;
  deleteIndicatorConfig(id: string, userId: string): Promise<void>;
  deleteIndicatorConfigsForUser(userId: string): Promise<void>;
  ensureIndicatorConfigsSeed(userId: string): Promise<void>;

  getOpenPositions(userId: string): Promise<Position[]>;
  getPositionById(id: string): Promise<Position | undefined>;
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

  getPairTimeframes(symbol?: string): Promise<PairTimeframe[]>;
  replacePairTimeframes(symbol: string, timeframes: string[]): Promise<PairTimeframe[]>;

  getMarketData(symbols?: string[]): Promise<MarketData[]>;
  updateMarketData(data: Partial<MarketData> & { symbol: string }): Promise<void>;
}

function mapPositionRow(row: Record<string, any>): Position {
  return {
    id: row.id,
    userId: row.user_id,
    symbol: row.symbol,
    side: row.side,
    size: row.size,
    entryPrice: row.entry_price,
    currentPrice: row.current_price ?? undefined,
    pnl: row.pnl ?? undefined,
    stopLoss: row.stop_loss ?? undefined,
    takeProfit: row.take_profit ?? undefined,
    trailingStopPercent: row.trailing_stop_percent ?? undefined,
    status: row.status,
    orderId: row.order_id ?? undefined,
    openedAt: row.opened_at,
    closedAt: row.closed_at ?? undefined,
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

  async upsertUserSettings(settings: InsertUserSettings): Promise<UserSettings> {
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
    };

    const insertPayload = {
      ...pruneUndefined(settings),
      updatedAt: now,
    } as UserSettingsInsert;
    const updatePayload = pruneUndefined({ ...settings }) as Partial<UserSettingsInsert>;
    delete (updatePayload as Record<string, unknown>).userId;

    const insertColumns = Object.keys(insertPayload).map((key) => columnMap[key as keyof UserSettingsInsert]);
    const insertValues = Object.values(insertPayload);

    const updateAssignments = Object.entries(updatePayload)
      .filter(([key]) => key !== "userId")
      .map(([key, value]) => sql`${sql.identifier(columnMap[key as keyof UserSettingsInsert])} = ${value}`);
    updateAssignments.push(sql`${sql.identifier(columnMap.updatedAt)} = ${now}`);

    const insertColumnsSql = sql.join(
      insertColumns.map((column) => sql.identifier(column)),
      sql`, `,
    );
    const insertValuesSql = sql.join(insertValues.map((value) => sql`${value}`), sql`, `);
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
        insertColumns,
        insertValues,
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
    const [row] = await db
      .insert(indicatorConfigs)
      .values({ ...config, id })
      .onConflictDoUpdate({
        target: [indicatorConfigs.userId, indicatorConfigs.name],
        set: {
          payload: config.payload,
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
      await db
        .insert(indicatorConfigs)
        .values({ id: randomUUID(), userId, name: config.name, payload: config.payload })
        .onConflictDoNothing({ target: [indicatorConfigs.userId, indicatorConfigs.name] });
    }
  }

  async getOpenPositions(userId: string): Promise<Position[]> {
    const result = await db.execute(
      sql`
        WITH deduped AS (
          SELECT DISTINCT ON (p.symbol, p.side, p.entry_price, p.opened_at)
            p.*
          FROM ${positions} p
          WHERE p.user_id = ${userId} AND p.status = 'OPEN'
          ORDER BY p.symbol, p.side, p.entry_price, p.opened_at DESC
        )
        SELECT * FROM deduped
        ORDER BY opened_at DESC;
      `,
    );

    return result.rows.map((row) => mapPositionRow(row));
  }

  async getPositionById(id: string): Promise<Position | undefined> {
    const [position] = await db.select().from(positions).where(eq(positions.id, id)).limit(1);
    return position;
  }

  async createPosition(position: InsertPosition): Promise<Position> {
    const id = randomUUID();
    const [result] = await db.insert(positions).values({ ...position, id }).returning();
    return result;
  }

  async updatePosition(id: string, updates: Partial<Position>): Promise<Position> {
    const [result] = await db.update(positions).set(updates).where(eq(positions.id, id)).returning();
    return result;
  }

  async closePosition(
    id: string,
    updates: { closePrice?: string; pnl?: string } = {},
  ): Promise<Position> {
    const updateData: Partial<typeof positions.$inferInsert> = {
      status: "CLOSED",
      closedAt: new Date(),
    };

    if (updates.closePrice !== undefined) {
      updateData.currentPrice = updates.closePrice;
    }

    if (updates.pnl !== undefined) {
      updateData.pnl = updates.pnl;
    }

    const [result] = await db
      .update(positions)
      .set(updateData)
      .where(eq(positions.id, id))
      .returning();
    return result;
  }

  async closeAllUserPositions(
    userId: string,
    computeUpdates?: (position: Position) => { closePrice?: string; pnl?: string },
  ): Promise<Position[]> {
    const openPositions = await db
      .select()
      .from(positions)
      .where(and(eq(positions.userId, userId), eq(positions.status, "OPEN")));

    const results: Position[] = [];

    for (const position of openPositions) {
      const updates = computeUpdates ? computeUpdates(position) : {};
      const updateData: Partial<typeof positions.$inferInsert> = {
        status: "CLOSED",
        closedAt: new Date(),
      };

      if (updates?.closePrice !== undefined) {
        updateData.currentPrice = updates.closePrice;
      }

      if (updates?.pnl !== undefined) {
        updateData.pnl = updates.pnl;
      }

      const [result] = await db
        .update(positions)
        .set(updateData)
        .where(eq(positions.id, position.id))
        .returning();

      results.push(result);
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

  async getPairTimeframes(symbol?: string): Promise<PairTimeframe[]> {
    if (symbol) {
      return db.select().from(pairTimeframes).where(eq(pairTimeframes.symbol, symbol));
    }
    return db.select().from(pairTimeframes);
  }

  async replacePairTimeframes(symbol: string, timeframes: string[]): Promise<PairTimeframe[]> {
    return db.transaction(async (tx) => {
      await tx.delete(pairTimeframes).where(eq(pairTimeframes.symbol, symbol));

      if (timeframes.length === 0) {
        return [] as PairTimeframe[];
      }

      const rows: PairTimeframe[] = [];
      for (const timeframe of timeframes) {
        const [row] = await tx
          .insert(pairTimeframes)
          .values({ id: randomUUID(), symbol, timeframe })
          .onConflictDoNothing({ target: [pairTimeframes.symbol, pairTimeframes.timeframe] })
          .returning();
        if (row) {
          rows.push(row);
        }
      }
      return rows;
    });
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

  async updateMarketData(data: Partial<MarketData> & { symbol: string }): Promise<void> {
    await db
      .insert(marketData)
      .values(data as any)
      .onConflictDoUpdate({
        target: [marketData.symbol, marketData.timeframe],
        set: data as any,
      });
  }
}

export const storage = new DatabaseStorage();
