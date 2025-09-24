import { pgTable, serial, varchar, numeric, integer, timestamp } from "drizzle-orm/pg-core";

export const paperAccounts = pgTable("paper_accounts", {
    id: serial("id").primaryKey(),
    balance: numeric("balance", { precision: 18, scale: 8 }).notNull().default("10000"),
    feeMakerBps: integer("fee_maker_bps").notNull().default(1),   // 0.01%
    feeTakerBps: integer("fee_taker_bps").notNull().default(5),   // 0.05%
    slippageBps: integer("slippage_bps").notNull().default(2),    // 0.02%
    latencyMs: integer("latency_ms").notNull().default(150),
    leverageMax: integer("leverage_max").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow(),
});

export const paperPositions = pgTable("paper_positions", {
    id: serial("id").primaryKey(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    qty: numeric("qty", { precision: 18, scale: 8 }).notNull().default("0"),
    avgPrice: numeric("avg_price", { precision: 18, scale: 8 }).notNull().default("0"),
    updatedAt: timestamp("updated_at").defaultNow(),
});

export const paperOrders = pgTable("paper_orders", {
    id: serial("id").primaryKey(),
    clientId: varchar("client_id", { length: 40 }).notNull(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    side: varchar("side", { length: 4 }).notNull(),       // BUY/SELL
    type: varchar("type", { length: 6 }).notNull(),       // MARKET/LIMIT
    qty: numeric("qty", { precision: 18, scale: 8 }).notNull(),
    price: numeric("price", { precision: 18, scale: 8 }),
    status: varchar("status", { length: 16 }).notNull().default("FILLED"),
    createdAt: timestamp("created_at").defaultNow(),
});

export const paperTrades = pgTable("paper_trades", {
    id: serial("id").primaryKey(),
    orderId: integer("order_id").notNull(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    price: numeric("price", { precision: 18, scale: 8 }).notNull(),
    qty: numeric("qty", { precision: 18, scale: 8 }).notNull(),
    fee: numeric("fee", { precision: 18, scale: 8 }).notNull().default("0"),
    ts: timestamp("ts").defaultNow(),
});
