BEGIN;

CREATE TABLE IF NOT EXISTS pair_timeframes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Ensure pair_timeframes has consistent timeframe column
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'pair_timeframes'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'pair_timeframes'
        AND column_name = 'timeframe'
    ) THEN
      EXECUTE 'ALTER TABLE pair_timeframes ADD COLUMN timeframe TEXT';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'pair_timeframes'
        AND column_name = 'tf'
    ) THEN
      EXECUTE 'ALTER TABLE pair_timeframes RENAME COLUMN tf TO timeframe';
    END IF;

    EXECUTE 'ALTER TABLE pair_timeframes ALTER COLUMN timeframe SET NOT NULL';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS pair_timeframes_symbol_timeframe_unique
  ON pair_timeframes (symbol, timeframe);

-- Align trading_pairs limit columns
DO $$
DECLARE
  column_record RECORD;
BEGIN
  FOR column_record IN
    SELECT column_name
    FROM (
      VALUES ('min_qty'), ('min_notional'), ('step_size'), ('tick_size')
    ) AS cols(column_name)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'trading_pairs'
        AND column_name = column_record.column_name
    ) THEN
      EXECUTE format(
        'ALTER TABLE trading_pairs ALTER COLUMN %I TYPE numeric(18,8) USING %I::numeric',
        column_record.column_name,
        column_record.column_name
      );
    ELSE
      EXECUTE format(
        'ALTER TABLE trading_pairs ADD COLUMN %I numeric(18,8)',
        column_record.column_name
      );
    END IF;
  END LOOP;
END $$;

-- Ensure closed_positions.pnl_usd is a regular numeric column with default 0
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'closed_positions'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'closed_positions'
        AND column_name = 'pnl_usd'
    ) THEN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'closed_positions'
          AND column_name = 'pnl_usd'
          AND is_generated = 'ALWAYS'
      ) THEN
        EXECUTE 'ALTER TABLE closed_positions ALTER COLUMN pnl_usd DROP EXPRESSION';
      END IF;

      EXECUTE 'ALTER TABLE closed_positions ALTER COLUMN pnl_usd TYPE numeric(18,8) USING pnl_usd::numeric';
      EXECUTE 'ALTER TABLE closed_positions ALTER COLUMN pnl_usd SET DEFAULT 0';
      EXECUTE 'UPDATE closed_positions SET pnl_usd = 0 WHERE pnl_usd IS NULL';
      EXECUTE 'ALTER TABLE closed_positions ALTER COLUMN pnl_usd SET NOT NULL';
    ELSE
      EXECUTE 'ALTER TABLE closed_positions ADD COLUMN pnl_usd numeric(18,8) NOT NULL DEFAULT 0';
    END IF;
  END IF;
END $$;

COMMIT;
