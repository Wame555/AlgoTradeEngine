import { sql } from "drizzle-orm";
import {
  boolean,
  decimal,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// User table
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 255 }),
    username: text("username").notNull(),
    password: text("password").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    emailUnique: unique("users_email_uniq").on(table.email),
    usernameUnique: unique("users_username_unique").on(table.username),
  }),
);

// Trading pairs
export const tradingPairs = pgTable("trading_pairs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: varchar("symbol", { length: 20 }).notNull().unique(),
  baseAsset: varchar("base_asset", { length: 10 }).notNull(),
  quoteAsset: varchar("quote_asset", { length: 10 }).notNull(),
  isActive: boolean("is_active").default(true),
  minNotional: numeric("min_notional", { precision: 18, scale: 8 }),
  minQty: numeric("min_qty", { precision: 18, scale: 8 }),
  stepSize: numeric("step_size", { precision: 18, scale: 8 }),
  tickSize: numeric("tick_size", { precision: 18, scale: 8 }),
});

// User settings
export const userSettings = pgTable(
  "user_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    telegramBotToken: text("telegram_bot_token"),
    telegramChatId: text("telegram_chat_id"),
    binanceApiKey: text("binance_api_key"),
    binanceApiSecret: text("binance_api_secret"),
    isTestnet: boolean("is_testnet").default(true),
    defaultLeverage: integer("default_leverage").default(1),
    riskPercent: real("risk_percent").default(2),
    demoEnabled: boolean("demo_enabled").default(true),
    defaultTpPct: numeric("default_tp_pct", { precision: 5, scale: 2 }).default("1.00"),
    defaultSlPct: numeric("default_sl_pct", { precision: 5, scale: 2 }).default("0.50"),
    totalBalance: numeric("total_balance", { precision: 18, scale: 2 }).notNull().default("10000.00"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    userIdUnique: unique("user_settings_user_id_uniq").on(table.userId),
  }),
);

// Indicator configurations
export const indicatorConfigs = pgTable(
  "indicator_configs",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull().default('GENERIC'),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    userNameUnique: uniqueIndex("idx_indicator_configs_user_name").on(
      table.userId,
      table.name,
    ),
  }),
);

// Trading positions
export const positions = pgTable(
  "positions",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id").notNull(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    side: varchar("side", { length: 10 }).notNull(), // LONG, SHORT
    size: decimal("size", { precision: 18, scale: 8 }).notNull(),
    qty: numeric("qty", { precision: 18, scale: 8 }).notNull().default("0"),
    entryPrice: decimal("entry_price", { precision: 18, scale: 8 }).notNull(),
    currentPrice: decimal("current_price", { precision: 18, scale: 8 }),
    pnl: decimal("pnl", { precision: 18, scale: 8 }).default("0"),
    stopLoss: decimal("stop_loss", { precision: 18, scale: 8 }),
    takeProfit: decimal("take_profit", { precision: 18, scale: 8 }),
    tpPrice: numeric("tp_price", { precision: 18, scale: 8 }),
    slPrice: numeric("sl_price", { precision: 18, scale: 8 }),
    leverage: numeric("leverage", { precision: 10, scale: 2 }).notNull().default("1"),
    amountUsd: numeric("amount_usd", { precision: 18, scale: 2 }),
    trailingStopPercent: numeric("trailing_stop_percent", { precision: 6, scale: 2 }),
    status: varchar("status", { length: 20 }).default("OPEN"), // OPEN, CLOSED, PENDING
    orderId: varchar("order_id", { length: 50 }),
    openedAt: timestamp("opened_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
    closedAt: timestamp("closed_at"),
  },
  (table) => ({
    userIdx: index("idx_positions_user").on(table.userId),
  }),
);

// Closed positions
export const closedPositions = pgTable(
  "closed_positions",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id").notNull(),
    symbol: text("symbol").notNull(),
    side: text("side").notNull(),
    size: numeric("size", { precision: 18, scale: 8 }).notNull(),
    entryPrice: numeric("entry_price", { precision: 18, scale: 8 }).notNull(),
    exitPrice: numeric("exit_price", { precision: 18, scale: 8 }).notNull(),
    feeUsd: numeric("fee_usd", { precision: 18, scale: 8 }).notNull().default("0"),
    pnlUsd: numeric("pnl_usd", { precision: 18, scale: 8 }).notNull().default("0"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    symbolClosedAtIdx: index("idx_closed_positions_symbol_time").on(
      table.symbol,
      table.closedAt,
    ),
    userIdx: index("idx_closed_positions_user").on(table.userId),
  }),
);

// Trading signals
export const signals = pgTable("signals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  timeframe: varchar("timeframe", { length: 10 }).notNull(),
  signal: varchar("signal", { length: 10 }).notNull(), // LONG, SHORT, WAIT
  confidence: numeric("confidence", { precision: 5, scale: 2 }).notNull(),
  indicators: jsonb("indicators"),
  price: decimal("price", { precision: 18, scale: 8 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Pair timeframe settings
export const pairTimeframes = pgTable(
  "pair_timeframes",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    timeframe: varchar("timeframe", { length: 10 }).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    symbolTimeframeUnique: uniqueIndex("pair_timeframes_symbol_timeframe_unique").on(
      table.symbol,
      table.timeframe,
    ),
  }),
);

export const userPairSettings = pgTable(
  "user_pair_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    activeTimeframes: text("active_timeframes").array().notNull().default(sql`ARRAY[]::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    userSymbolUnique: unique("user_pair_settings_user_symbol_uniq").on(table.userId, table.symbol),
    userIdx: index("idx_user_pair_settings_user").on(table.userId),
    symbolIdx: index("idx_user_pair_settings_symbol").on(table.symbol),
  }),
);

// Market data cache
export const marketData = pgTable(
  "market_data",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull(),
    timeframe: text("timeframe").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    open: numeric("open", { precision: 18, scale: 8 }).notNull(),
    high: numeric("high", { precision: 18, scale: 8 }).notNull(),
    low: numeric("low", { precision: 18, scale: 8 }).notNull(),
    close: numeric("close", { precision: 18, scale: 8 }).notNull(),
    volume: numeric("volume", { precision: 30, scale: 10 }).notNull(),
  },
  (table) => ({
    symbolTimeframeTsUnique: uniqueIndex("market_data_symbol_timeframe_ts_uniq").on(
      table.symbol,
      table.timeframe,
      table.ts,
    ),
    symbolTimeframeIndex: index("idx_market_data_symbol_timeframe").on(
      table.symbol,
      table.timeframe,
    ),
    symbolTimeframeTsIndex: index("idx_market_data_sym_tf_ts").on(
      table.symbol,
      table.timeframe,
      table.ts,
    ),
  }),
);

// Create insert schemas
export const insertUserSchema = createInsertSchema(users).pick({
  email: true,
  username: true,
  password: true,
});

export const insertUserSettingsSchema = createInsertSchema(userSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertIndicatorConfigSchema = createInsertSchema(indicatorConfigs, {
  type: z.string().min(1).default('GENERIC'),
}).omit({
  id: true,
  createdAt: true,
});

export const insertPositionSchema = createInsertSchema(positions).omit({
  id: true,
  openedAt: true,
  closedAt: true,
  updatedAt: true,
});

export const insertSignalSchema = createInsertSchema(signals).omit({
  id: true,
  createdAt: true,
});

export const insertPairTimeframeSchema = createInsertSchema(pairTimeframes).omit({
  id: true,
  createdAt: true,
});

export const insertUserPairSettingsSchema = createInsertSchema(userPairSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
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
export type UserPairSetting = typeof userPairSettings.$inferSelect;
export type InsertUserPairSetting = z.infer<typeof insertUserPairSettingsSchema>;
export type ClosedPosition = typeof closedPositions.$inferSelect;
export type InsertClosedPosition = typeof closedPositions.$inferInsert;
export type MarketData = typeof marketData.$inferSelect;
