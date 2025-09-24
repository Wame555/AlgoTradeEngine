-- Ensure pair_timeframes has a consistent timeframe column before creating the unique index
DO $$
DECLARE
  has_tf_column boolean;
  has_timeframe_column boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pair_timeframes'
      AND column_name = 'tf'
  )
  INTO has_tf_column;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pair_timeframes'
      AND column_name = 'timeframe'
  )
  INTO has_timeframe_column;

  IF has_tf_column THEN
    IF has_timeframe_column THEN
      EXECUTE 'UPDATE "pair_timeframes" SET "timeframe" = COALESCE("timeframe", "tf") WHERE "tf" IS NOT NULL';
      EXECUTE 'ALTER TABLE "pair_timeframes" DROP COLUMN "tf"';
    ELSE
      EXECUTE 'ALTER TABLE "pair_timeframes" RENAME COLUMN "tf" TO "timeframe"';
      has_timeframe_column := true;
    END IF;
  END IF;

  IF NOT has_timeframe_column THEN
    EXECUTE 'ALTER TABLE "pair_timeframes" ADD COLUMN "timeframe" text';
    has_timeframe_column := true;
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pair_timeframes'
      AND column_name = 'timeframe'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS "pair_timeframes_symbol_timeframe_unique" ON "pair_timeframes" ("symbol", "timeframe")';
  END IF;
END
$$;

-- Ensure trading_pairs limit columns exist
ALTER TABLE "trading_pairs"
  ADD COLUMN IF NOT EXISTS "min_qty" numeric(18, 8);
ALTER TABLE "trading_pairs"
  ADD COLUMN IF NOT EXISTS "min_notional" numeric(18, 8);
ALTER TABLE "trading_pairs"
  ADD COLUMN IF NOT EXISTS "step_size" numeric(18, 8);
ALTER TABLE "trading_pairs"
  ADD COLUMN IF NOT EXISTS "tick_size" numeric(18, 8);
