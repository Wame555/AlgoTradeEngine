-- Ensure pair_timeframes.timeframe column exists and is consistent
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pair_timeframes'
      AND column_name = 'tf'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'pair_timeframes'
        AND column_name = 'timeframe'
    ) THEN
      EXECUTE 'UPDATE "pair_timeframes" SET "timeframe" = COALESCE("timeframe", "tf") WHERE "tf" IS NOT NULL';
      EXECUTE 'ALTER TABLE "pair_timeframes" DROP COLUMN "tf"';
    ELSE
      EXECUTE 'ALTER TABLE "pair_timeframes" RENAME COLUMN "tf" TO "timeframe"';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pair_timeframes'
      AND column_name = 'timeframe'
  ) THEN
    EXECUTE 'ALTER TABLE "pair_timeframes" ADD COLUMN "timeframe" text';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "pair_timeframes_symbol_timeframe_unique"
  ON "pair_timeframes" ("symbol", "timeframe");

-- Ensure trading_pairs limit columns exist
ALTER TABLE "trading_pairs"
  ADD COLUMN IF NOT EXISTS "min_qty" numeric(18, 8);
ALTER TABLE "trading_pairs"
  ADD COLUMN IF NOT EXISTS "min_notional" numeric(18, 8);
ALTER TABLE "trading_pairs"
  ADD COLUMN IF NOT EXISTS "step_size" numeric(18, 8);
ALTER TABLE "trading_pairs"
  ADD COLUMN IF NOT EXISTS "tick_size" numeric(18, 8);
