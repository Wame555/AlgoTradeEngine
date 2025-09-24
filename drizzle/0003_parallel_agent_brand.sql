-- Safely create the pair_timeframes unique index only when the timeframe column exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'pair_timeframes'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'pair_timeframes'
        AND column_name = 'timeframe'
    ) THEN
      EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS "pair_timeframes_symbol_timeframe_unique" ON "pair_timeframes" USING btree ("symbol", "timeframe")';
    END IF;
  END IF;
END
$$;
