import { sql } from 'drizzle-orm';
import {
  pgTable,
  varchar,
  text,
  decimal,
  integer,
  timestamp,
  boolean,
  jsonb,
  numeric,
  real,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';

// User table
export const users = pgTable('users', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  username: text('username').notNull().unique(),
  password: text('password').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// Trading pairs
export const tradingPairs = pgTable('trading_pairs', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  symbol: varchar('symbol', { length: 20 }).notNull().unique(),
  baseAsset: varchar('base_asset', { length: 10 }).notNull(),
  quoteAsset: varchar('quote_asset', { length: 10 }).notNull(),
  isActive: boolean('is_active').default(true),
  minNotional: numeric('min_notional', { precision: 18, scale: 8 }),
  minQty: numeric('min_qty', { precision: 18, scale: 8 }),
  stepSize: numeric('step_size', { precision: 18, scale: 8 }),
  tickSize: numeric('tick_size', { precision: 18, scale: 8 }),
});

// User settings
export const userSettings = pgTable('user_settings', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar('user_id').notNull().unique(),
  telegramBotToken: text('telegram_bot_token'),
  telegramChatId: text('telegram_chat_id'),
  binanceApiKey: text('binance_api_key'),
  binanceApiSecret: text('binance_api_secret'),
  isTestnet: boolean('is_testnet').default(true),
  defaultLeverage: integer('default_leverage').default(1),
  riskPercent: real('risk_percent').default(2),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Indicator configurations
export const indicatorConfigs = pgTable('indicator_configs', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull().unique(),
  params: jsonb('params').$type<Record<string, unknown>>().default({}),
  enabled: boolean('enabled').notNull().default(false),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Trading positions
export const positions = pgTable('positions', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar('user_id').notNull(),
  symbol: varchar('symbol', { length: 20 }).notNull(),
  side: varchar('side', { length: 10 }).notNull(), // LONG, SHORT
  size: decimal('size', { precision: 18, scale: 8 }).notNull(),
  entryPrice: decimal('entry_price', { precision: 18, scale: 8 }).notNull(),
  currentPrice: decimal('current_price', { precision: 18, scale: 8 }),
  pnl: decimal('pnl', { precision: 18, scale: 8 }).default('0'),
  stopLoss: decimal('stop_loss', { precision: 18, scale: 8 }),
  takeProfit: decimal('take_profit', { precision: 18, scale: 8 }),
  trailingStopPercent: numeric('trailing_stop_percent', { precision: 6, scale: 2 }),
  status: varchar('status', { length: 20 }).default('OPEN'), // OPEN, CLOSED, PENDING
  orderId: varchar('order_id', { length: 50 }),
  openedAt: timestamp('opened_at').defaultNow(),
  closedAt: timestamp('closed_at'),
});

// Closed positions
export const closedPositions = pgTable('closed_positions', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  symbol: text('symbol').notNull(),
  side: text('side').notNull(),
  entryTs: timestamp('entry_ts', { withTimezone: true }).notNull(),
  exitTs: timestamp('exit_ts', { withTimezone: true }).notNull(),
  entryPx: numeric('entry_px', { precision: 18, scale: 8 }).notNull(),
  exitPx: numeric('exit_px', { precision: 18, scale: 8 }).notNull(),
  qty: numeric('qty', { precision: 18, scale: 8 }).notNull(),
  fee: numeric('fee', { precision: 18, scale: 8 }).notNull().default('0'),
  pnlUsd: numeric('pnl_usd', { precision: 18, scale: 8 }).notNull().default(0),
});

// Trading signals
export const signals = pgTable('signals', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  symbol: varchar('symbol', { length: 20 }).notNull(),
  timeframe: varchar('timeframe', { length: 10 }).notNull(),
  signal: varchar('signal', { length: 10 }).notNull(), // LONG, SHORT, WAIT
  confidence: numeric('confidence', { precision: 5, scale: 2 }).notNull(),
  indicators: jsonb('indicators'),
  price: decimal('price', { precision: 18, scale: 8 }).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// Pair timeframe settings
export const pairTimeframes = pgTable('pair_timeframes', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  symbol: varchar('symbol', { length: 20 }).notNull(),
  timeframe: varchar('timeframe', { length: 10 }).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  symbolTimeframeUnique: uniqueIndex('pair_timeframes_symbol_timeframe_unique').on(
    table.symbol,
    table.timeframe,
  ),
}));

// Market data cache
export const marketData = pgTable('market_data', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  symbol: varchar('symbol', { length: 20 }).notNull(),
  timeframe: varchar('timeframe', { length: 10 }).notNull(),
  price: decimal('price', { precision: 18, scale: 8 }).notNull(),
  volume: decimal('volume', { precision: 18, scale: 8 }),
  change24h: numeric('change_24h', { precision: 8, scale: 2 }),
  high24h: decimal('high_24h', { precision: 18, scale: 8 }),
  low24h: decimal('low_24h', { precision: 18, scale: 8 }),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Create insert schemas
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertUserSettingsSchema = createInsertSchema(userSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertIndicatorConfigSchema = createInsertSchema(indicatorConfigs).omit({
  id: true,
  updatedAt: true,
});

export const insertPositionSchema = createInsertSchema(positions).omit({
  id: true,
  openedAt: true,
  closedAt: true,
});

export const insertSignalSchema = createInsertSchema(signals).omit({
  id: true,
  createdAt: true,
});

export const insertPairTimeframeSchema = createInsertSchema(pairTimeframes).omit({
  id: true,
  createdAt: true,
});

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type TradingPair = typeof tradingPairs.$inferSelect;
export type UserSettings = typeof userSettings.$inferSelect;
export type InsertUserSettings = z.infer<typeof insertUserSettingsSchema>;
export type IndicatorConfig = typeof indicatorConfigs.$inferSelect;
export type InsertIndicatorConfig = z.infer<typeof insertIndicatorConfigSchema>;
export type Position = typeof positions.$inferSelect;
export type InsertPosition = z.infer<typeof insertPositionSchema>;
export type Signal = typeof signals.$inferSelect;
export type InsertSignal = z.infer<typeof insertSignalSchema>;
export type PairTimeframe = typeof pairTimeframes.$inferSelect;
export type InsertPairTimeframe = z.infer<typeof insertPairTimeframeSchema>;
export type ClosedPosition = typeof closedPositions.$inferSelect;
export type InsertClosedPosition = typeof closedPositions.$inferInsert;
export type MarketData = typeof marketData.$inferSelect;
