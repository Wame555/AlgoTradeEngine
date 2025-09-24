CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS "users" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "username" text NOT NULL,
        "password" text NOT NULL,
        "created_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "user_settings" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" varchar NOT NULL,
        "telegram_bot_token" text,
        "telegram_chat_id" text,
        "binance_api_key" text,
        "binance_api_secret" text,
        "is_testnet" boolean DEFAULT true,
        "default_leverage" integer DEFAULT 1,
        "risk_percent" real DEFAULT 2,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "trading_pairs" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "symbol" varchar(20) NOT NULL,
        "base_asset" varchar(10) NOT NULL,
        "quote_asset" varchar(10) NOT NULL,
        "is_active" boolean DEFAULT true,
        "min_notional" numeric(18, 8),
        "min_qty" numeric(18, 8),
        "step_size" numeric(18, 8),
        "tick_size" numeric(18, 8)
);

CREATE TABLE IF NOT EXISTS "indicator_configs" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "name" text NOT NULL,
        "params" jsonb DEFAULT '{}'::jsonb,
        "enabled" boolean DEFAULT false NOT NULL,
        "updated_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "positions" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" varchar NOT NULL,
        "symbol" varchar(20) NOT NULL,
        "side" varchar(10) NOT NULL,
        "size" numeric(18, 8) NOT NULL,
        "entry_price" numeric(18, 8) NOT NULL,
        "current_price" numeric(18, 8),
        "pnl" numeric(18, 8) DEFAULT '0',
        "stop_loss" numeric(18, 8),
        "take_profit" numeric(18, 8),
        "trailing_stop_percent" numeric(6, 2),
        "status" varchar(20) DEFAULT 'OPEN',
        "order_id" varchar(50),
        "opened_at" timestamp DEFAULT now(),
        "closed_at" timestamp
);

CREATE TABLE IF NOT EXISTS "closed_positions" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "symbol" text NOT NULL,
        "side" text NOT NULL,
        "entry_ts" timestamp with time zone NOT NULL,
        "exit_ts" timestamp with time zone NOT NULL,
        "entry_px" numeric(18, 8) NOT NULL,
        "exit_px" numeric(18, 8) NOT NULL,
        "qty" numeric(18, 8) NOT NULL,
        "fee" numeric(18, 8) DEFAULT '0' NOT NULL,
        "pnl_usd" numeric(18, 8) DEFAULT '0'
);

CREATE TABLE IF NOT EXISTS "signals" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "symbol" varchar(20) NOT NULL,
        "timeframe" varchar(10) NOT NULL,
        "signal" varchar(10) NOT NULL,
        "confidence" numeric(5, 2) NOT NULL,
        "indicators" jsonb,
        "price" numeric(18, 8) NOT NULL,
        "created_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "pair_timeframes" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "symbol" varchar(20) NOT NULL,
        "timeframe" varchar(10) NOT NULL,
        "created_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "market_data" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "symbol" varchar(20) NOT NULL,
        "timeframe" varchar(10) NOT NULL,
        "price" numeric(18, 8) NOT NULL,
        "volume" numeric(18, 8),
        "change_24h" numeric(8, 2),
        "high_24h" numeric(18, 8),
        "low_24h" numeric(18, 8),
        "updated_at" timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "users_username_unique" ON "users" ("username");
CREATE UNIQUE INDEX IF NOT EXISTS "user_settings_user_id_unique" ON "user_settings" ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "trading_pairs_symbol_unique" ON "trading_pairs" ("symbol");
CREATE UNIQUE INDEX IF NOT EXISTS "indicator_configs_name_unique" ON "indicator_configs" ("name");
CREATE UNIQUE INDEX IF NOT EXISTS "pair_timeframes_symbol_timeframe_unique" ON "pair_timeframes" ("symbol", "timeframe");
