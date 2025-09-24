DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'pair_timeframes'
  ) THEN
    EXECUTE '
      CREATE TABLE "pair_timeframes" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "symbol" text NOT NULL,
        "timeframe" text NOT NULL,
        "created_at" timestamp DEFAULT now()
      )
    ';
  END IF;
END $$;

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
        AND column_name = 'tf'
    ) THEN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'pair_timeframes'
          AND column_name = 'timeframe'
      ) THEN
        EXECUTE 'ALTER TABLE "pair_timeframes" RENAME COLUMN "tf" TO "timeframe"';
      ELSE
        EXECUTE 'UPDATE "pair_timeframes" SET "timeframe" = COALESCE("timeframe", "tf") WHERE "tf" IS NOT NULL';
        EXECUTE 'ALTER TABLE "pair_timeframes" DROP COLUMN "tf"';
      END IF;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'pair_timeframes'
        AND column_name = 'timeframe'
    ) THEN
      EXECUTE 'ALTER TABLE "pair_timeframes" ADD COLUMN "timeframe" text';
    END IF;
  END IF;
END $$;

DO $$
DECLARE
  has_nulls boolean;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pair_timeframes'
      AND column_name = 'timeframe'
  ) THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM "pair_timeframes" WHERE "timeframe" IS NULL)' INTO has_nulls;
    IF NOT has_nulls THEN
      EXECUTE 'ALTER TABLE "pair_timeframes" ALTER COLUMN "timeframe" SET NOT NULL';
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pair_timeframes'
      AND column_name = 'timeframe'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'pair_timeframes'
        AND indexname = 'pair_timeframes_symbol_timeframe_unique'
    ) THEN
      EXECUTE 'DROP INDEX IF EXISTS "pair_timeframes_symbol_timeframe_unique"';
    END IF;

    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS "pair_timeframes_symbol_timeframe_unique" ON "pair_timeframes" ("symbol", "timeframe")';
  END IF;
END $$;
