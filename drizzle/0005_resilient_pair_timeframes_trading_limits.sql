-- Ensure the pair_timeframes table exists with a usable timeframe column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'pair_timeframes'
  ) THEN
    EXECUTE '
      CREATE TABLE IF NOT EXISTS "pair_timeframes" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "symbol" text NOT NULL,
        "timeframe" text NOT NULL,
        "created_at" timestamp DEFAULT now()
      )
    ';
  END IF;
END
$$;

-- Guarantee that the timeframe column is present and populated
ALTER TABLE "pair_timeframes"
  ADD COLUMN IF NOT EXISTS "timeframe" text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pair_timeframes'
      AND column_name = 'tf'
  ) THEN
    EXECUTE 'UPDATE "pair_timeframes" SET "timeframe" = COALESCE("timeframe", "tf") WHERE "tf" IS NOT NULL';
    EXECUTE 'ALTER TABLE "pair_timeframes" DROP COLUMN "tf"';
  END IF;
END
$$;

DO $$
DECLARE
  has_null_timeframes boolean;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pair_timeframes'
      AND column_name = 'timeframe'
  ) THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM "pair_timeframes" WHERE "timeframe" IS NULL)' INTO has_null_timeframes;
    IF NOT has_null_timeframes THEN
      EXECUTE 'ALTER TABLE "pair_timeframes" ALTER COLUMN "timeframe" SET NOT NULL';
    END IF;
  END IF;
END
$$;

-- Create the unique index only when the timeframe column is present
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
