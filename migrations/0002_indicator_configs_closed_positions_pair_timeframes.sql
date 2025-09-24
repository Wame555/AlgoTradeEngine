BEGIN;

DROP TABLE IF EXISTS indicator_configs;
CREATE TABLE IF NOT EXISTS indicator_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    params JSONB DEFAULT '{}'::jsonb,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS closed_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    entry_ts TIMESTAMPTZ NOT NULL,
    exit_ts TIMESTAMPTZ NOT NULL,
    entry_px NUMERIC(18,8) NOT NULL,
    exit_px NUMERIC(18,8) NOT NULL,
    qty NUMERIC(18,8) NOT NULL,
    fee NUMERIC(18,8) NOT NULL DEFAULT 0,
    pnl_usd NUMERIC(18,8) NOT NULL DEFAULT 0
);

DROP TABLE IF EXISTS pair_timeframes;
CREATE TABLE IF NOT EXISTS pair_timeframes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT pair_timeframes_symbol_timeframe_unique UNIQUE (symbol, timeframe)
);

ALTER TABLE trading_pairs
    ADD COLUMN IF NOT EXISTS min_qty NUMERIC(18,8),
    ADD COLUMN IF NOT EXISTS min_notional NUMERIC(18,8),
    ADD COLUMN IF NOT EXISTS step_size NUMERIC(18,8),
    ADD COLUMN IF NOT EXISTS tick_size NUMERIC(18,8);

INSERT INTO indicator_configs (name, params, enabled, updated_at)
VALUES
    ('RSI', '{"length": 14}'::jsonb, FALSE, NOW()),
    ('EMA', '{"length": 21}'::jsonb, FALSE, NOW()),
    ('FVG', '{"lookback": 50}'::jsonb, FALSE, NOW())
ON CONFLICT (name) DO UPDATE SET
    params = EXCLUDED.params,
    enabled = FALSE,
    updated_at = NOW();

COMMIT;
