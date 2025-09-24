import {
  users,
  userSettings,
  indicatorConfigs,
  positions,
  signals,
  pairTimeframes,
  marketData,
  tradingPairs,
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
  type InsertPairTimeframe,
  type MarketData,
  type TradingPair,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, gte, lte, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Settings operations
  getUserSettings(userId: string): Promise<UserSettings | undefined>;
  upsertUserSettings(settings: InsertUserSettings): Promise<UserSettings>;

  // Trading pairs operations
  getAllTradingPairs(): Promise<TradingPair[]>;
  getTradingPair(symbol: string): Promise<TradingPair | undefined>;

  // Indicator operations
  getUserIndicators(userId: string): Promise<IndicatorConfig[]>;
  createIndicatorConfig(config: InsertIndicatorConfig): Promise<IndicatorConfig>;
  updateIndicatorConfig(id: string, config: Partial<InsertIndicatorConfig>): Promise<IndicatorConfig>;
  deleteIndicatorConfig(id: string): Promise<void>;

  // Position operations
  getUserPositions(userId: string): Promise<Position[]>;
  getPositionById(id: string): Promise<Position | undefined>;
  createPosition(position: InsertPosition): Promise<Position>;
  updatePosition(id: string, updates: Partial<Position>): Promise<Position>;
  closePosition(id: string, updates?: { closePrice?: string; pnl?: string }): Promise<Position>;
  closeAllUserPositions(
    userId: string,
    computeUpdates?: (position: Position) => { closePrice?: string; pnl?: string }
  ): Promise<Position[]>;
  getUserPositionStats(userId: string): Promise<{
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    averageProfit: number;
  }>;

  // Signal operations
  getRecentSignals(limit?: number): Promise<Signal[]>;
  getSignalsBySymbol(symbol: string, limit?: number): Promise<Signal[]>;
  createSignal(signal: InsertSignal): Promise<Signal>;

  // Pair timeframe operations
  getUserPairTimeframes(userId: string): Promise<PairTimeframe[]>;
  upsertPairTimeframes(pairTimeframe: InsertPairTimeframe): Promise<PairTimeframe>;

  // Market data operations
  getMarketData(symbols?: string[]): Promise<MarketData[]>;
  updateMarketData(data: Partial<MarketData> & { symbol: string }): Promise<void>;
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
    const [user] = await db
      .insert(users)
      .values({ ...insertUser, id })
      .returning();
    return user;
  }

  async getUserSettings(userId: string): Promise<UserSettings | undefined> {
    const [settings] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId));
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
    return await db.select().from(tradingPairs).where(eq(tradingPairs.isActive, true));
  }

  async getTradingPair(symbol: string): Promise<TradingPair | undefined> {
    const [pair] = await db
      .select()
      .from(tradingPairs)
      .where(eq(tradingPairs.symbol, symbol));
    return pair;
  }

  async getUserIndicators(userId: string): Promise<IndicatorConfig[]> {
    return await db
      .select()
      .from(indicatorConfigs)
      .where(eq(indicatorConfigs.userId, userId))
      .orderBy(indicatorConfigs.name);
  }

  async createIndicatorConfig(config: InsertIndicatorConfig): Promise<IndicatorConfig> {
    const id = randomUUID();
    const [result] = await db
      .insert(indicatorConfigs)
      .values({ ...config, id })
      .returning();
    return result;
  }

  async updateIndicatorConfig(id: string, config: Partial<InsertIndicatorConfig>): Promise<IndicatorConfig> {
    const [result] = await db
      .update(indicatorConfigs)
      .set({ ...config, updatedAt: new Date() })
      .where(eq(indicatorConfigs.id, id))
      .returning();
    return result;
  }

  async deleteIndicatorConfig(id: string): Promise<void> {
    await db.delete(indicatorConfigs).where(eq(indicatorConfigs.id, id));
  }

  async getUserPositions(userId: string): Promise<Position[]> {
    return await db
      .select()
      .from(positions)
      .where(and(eq(positions.userId, userId), eq(positions.status, 'OPEN')))
      .orderBy(desc(positions.openedAt));
  }

  async getPositionById(id: string): Promise<Position | undefined> {
    const [position] = await db.select().from(positions).where(eq(positions.id, id)).limit(1);
    return position;
  }

  async createPosition(position: InsertPosition): Promise<Position> {
    const id = randomUUID();
    const [result] = await db
      .insert(positions)
      .values({ ...position, id })
      .returning();
    return result;
  }

  async updatePosition(id: string, updates: Partial<Position>): Promise<Position> {
    const [result] = await db
      .update(positions)
      .set(updates)
      .where(eq(positions.id, id))
      .returning();
    return result;
  }

  async closePosition(id: string, updates: { closePrice?: string; pnl?: string } = {}): Promise<Position> {
    const updateData: Partial<typeof positions.$inferInsert> = {
      status: 'CLOSED',
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
    computeUpdates?: (position: Position) => { closePrice?: string; pnl?: string }
  ): Promise<Position[]> {
    const openPositions = await db
      .select()
      .from(positions)
      .where(and(eq(positions.userId, userId), eq(positions.status, 'OPEN')));

    const results: Position[] = [];

    for (const position of openPositions) {
      const updates = computeUpdates ? computeUpdates(position) : {};
      const updateData: Partial<typeof positions.$inferInsert> = {
        status: 'CLOSED',
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

  async getUserPositionStats(userId: string): Promise<{
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    averageProfit: number;
  }> {
    const rows = await db
      .select()
      .from(positions)
      .where(eq(positions.userId, userId));

    const totalTrades = rows.length;
    let winningTrades = 0;
    let losingTrades = 0;
    let totalProfit = 0;
    let closedCount = 0;

    for (const row of rows) {
      if (row.status === 'CLOSED') {
        closedCount += 1;
        const pnl = Number(row.pnl ?? 0);
        totalProfit += pnl;
        if (pnl > 0) {
          winningTrades += 1;
        } else if (pnl < 0) {
          losingTrades += 1;
        }
      }
    }

    const averageProfit = closedCount > 0 ? totalProfit / closedCount : 0;

    return {
      totalTrades,
      winningTrades,
      losingTrades,
      averageProfit,
    };
  }

  async getRecentSignals(limit: number = 50): Promise<Signal[]> {
    return await db
      .select()
      .from(signals)
      .orderBy(desc(signals.createdAt))
      .limit(limit);
  }

  async getSignalsBySymbol(symbol: string, limit: number = 20): Promise<Signal[]> {
    return await db
      .select()
      .from(signals)
      .where(eq(signals.symbol, symbol))
      .orderBy(desc(signals.createdAt))
      .limit(limit);
  }

  async createSignal(signal: InsertSignal): Promise<Signal> {
    const id = randomUUID();
    const [result] = await db
      .insert(signals)
      .values({ ...signal, id })
      .returning();
    return result;
  }

  async getUserPairTimeframes(userId: string): Promise<PairTimeframe[]> {
    return await db
      .select()
      .from(pairTimeframes)
      .where(eq(pairTimeframes.userId, userId));
  }

  async upsertPairTimeframes(pairTimeframe: InsertPairTimeframe): Promise<PairTimeframe> {
    const id = randomUUID();
    const [result] = await db
      .insert(pairTimeframes)
      .values({ ...pairTimeframe, id })
      .onConflictDoUpdate({
        target: [pairTimeframes.userId, pairTimeframes.symbol],
        set: {
          timeframes: pairTimeframe.timeframes,
          updatedAt: new Date(),
        },
      })
      .returning();
    return result;
  }

  async getMarketData(symbols?: string[]): Promise<MarketData[]> {
    if (symbols && symbols.length > 0) {
      return await db.select()
        .from(marketData)
        .where(inArray(marketData.symbol, symbols))
        .orderBy(marketData.symbol);
    }
    
    return await db.select()
      .from(marketData)
      .orderBy(marketData.symbol);
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
}

export const storage = new DatabaseStorage();
