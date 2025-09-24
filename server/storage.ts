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
  type InsertClosedPosition,
  type ClosedPosition,
} from "@shared/schema";
import { db } from "./db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  getUserSettings(userId: string): Promise<UserSettings | undefined>;
  upsertUserSettings(settings: InsertUserSettings): Promise<UserSettings>;

  getAllTradingPairs(): Promise<TradingPair[]>;
  getTradingPair(symbol: string): Promise<TradingPair | undefined>;

  getIndicatorConfigs(): Promise<IndicatorConfig[]>;
  upsertIndicatorConfigs(configs: InsertIndicatorConfig[]): Promise<IndicatorConfig[]>;
  setAllIndicatorConfigsEnabled(enabled: boolean): Promise<void>;

  getUserPositions(userId: string): Promise<Position[]>;
  getPositionById(id: string): Promise<Position | undefined>;
  createPosition(position: InsertPosition): Promise<Position>;
  updatePosition(id: string, updates: Partial<Position>): Promise<Position>;
  closePosition(id: string, updates?: { closePrice?: string; pnl?: string }): Promise<Position>;
  closeAllUserPositions(
    userId: string,
    computeUpdates?: (position: Position) => { closePrice?: string; pnl?: string },
  ): Promise<Position[]>;

  getRecentSignals(limit?: number): Promise<Signal[]>;
  getSignalsBySymbol(symbol: string, limit?: number): Promise<Signal[]>;
  createSignal(signal: InsertSignal): Promise<Signal>;

  getPairTimeframes(symbol?: string): Promise<PairTimeframe[]>;
  replacePairTimeframes(symbol: string, timeframes: string[]): Promise<PairTimeframe[]>;

  getMarketData(symbols?: string[]): Promise<MarketData[]>;
  updateMarketData(data: Partial<MarketData> & { symbol: string }): Promise<void>;

  insertClosedPosition(data: InsertClosedPosition): Promise<ClosedPosition>;
  deleteAllClosedPositions(): Promise<void>;
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
    const [user] = await db.insert(users).values({ ...insertUser, id }).returning();
    return user;
  }

  async getUserSettings(userId: string): Promise<UserSettings | undefined> {
    const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
    return settings;
  }

  async upsertUserSettings(settings: InsertUserSettings): Promise<UserSettings> {
    const [result] = await db
      .insert(userSettings)
      .values(settings)
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: {
          ...settings,
          updatedAt: new Date(),
        },
      })
      .returning();
    return result;
  }

  async getAllTradingPairs(): Promise<TradingPair[]> {
    return db.select().from(tradingPairs).where(eq(tradingPairs.isActive, true));
  }

  async getTradingPair(symbol: string): Promise<TradingPair | undefined> {
    const [pair] = await db.select().from(tradingPairs).where(eq(tradingPairs.symbol, symbol));
    return pair;
  }

  async getIndicatorConfigs(): Promise<IndicatorConfig[]> {
    return db.select().from(indicatorConfigs).orderBy(indicatorConfigs.name);
  }

  async upsertIndicatorConfigs(configs: InsertIndicatorConfig[]): Promise<IndicatorConfig[]> {
    if (configs.length === 0) {
      return this.getIndicatorConfigs();
    }

    const inserted: IndicatorConfig[] = [];
    for (const config of configs) {
      const payload = { ...config, id: randomUUID(), updatedAt: new Date() } as any;
      const [result] = await db
        .insert(indicatorConfigs)
        .values(payload)
        .onConflictDoUpdate({
          target: indicatorConfigs.name,
          set: {
            params: config.params ?? {},
            enabled: config.enabled ?? false,
            updatedAt: new Date(),
          },
        })
        .returning();
      inserted.push(result);
    }
    return inserted;
  }

  async setAllIndicatorConfigsEnabled(enabled: boolean): Promise<void> {
    await db.update(indicatorConfigs).set({ enabled, updatedAt: new Date() });
  }

  async getUserPositions(userId: string): Promise<Position[]> {
    return db
      .select()
      .from(positions)
      .where(and(eq(positions.userId, userId), eq(positions.status, "OPEN")))
      .orderBy(desc(positions.openedAt));
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

  async closePosition(id: string, updates: { closePrice?: string; pnl?: string } = {}): Promise<Position> {
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
        return [];
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
        set: {
          ...data,
          updatedAt: new Date(),
        },
      });
  }

  async insertClosedPosition(data: InsertClosedPosition): Promise<ClosedPosition> {
    const id = randomUUID();
    const [row] = await db.insert(closedPositions).values({ ...data, id } as any).returning();
    return row;
  }

  async deleteAllClosedPositions(): Promise<void> {
    await db.delete(closedPositions);
  }
}

export const storage = new DatabaseStorage();
