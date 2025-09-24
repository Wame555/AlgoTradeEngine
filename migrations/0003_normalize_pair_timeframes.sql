BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'pair_timeframes'
  ) THEN
    EXECUTE '
      CREATE TABLE IF NOT EXISTS pair_timeframes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        symbol TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    ';
  END IF;
END $$;

ALTER TABLE pair_timeframes
  ADD COLUMN IF NOT EXISTS timeframe TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pair_timeframes'
      AND column_name = 'tf'
  ) THEN
    EXECUTE 'UPDATE pair_timeframes SET timeframe = COALESCE(timeframe, tf) WHERE tf IS NOT NULL';
    EXECUTE 'ALTER TABLE pair_timeframes DROP COLUMN tf';
  END IF;
END $$;

ALTER TABLE pair_timeframes
  ALTER COLUMN timeframe SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pair_timeframes_symbol_timeframe_unique
  ON pair_timeframes (symbol, timeframe);

COMMIT;
