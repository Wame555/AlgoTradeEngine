-- Ensure the pair_timeframes table exists with the expected shape
CREATE TABLE IF NOT EXISTS public."pair_timeframes" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "symbol" varchar(20) NOT NULL,
    "timeframe" varchar(10),
    "created_at" timestamp DEFAULT now()
);

-- Ensure timeframe column exists even on legacy schemas
ALTER TABLE public."pair_timeframes" ADD COLUMN IF NOT EXISTS "timeframe" varchar(10);
ALTER TABLE public."pair_timeframes" ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT now();

-- Backfill from legacy tf column and drop it if present
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'pair_timeframes'
          AND column_name = 'tf'
    ) THEN
        EXECUTE 'UPDATE public."pair_timeframes" SET "timeframe" = COALESCE("timeframe", "tf") WHERE "tf" IS NOT NULL';
        EXECUTE 'ALTER TABLE public."pair_timeframes" DROP COLUMN "tf"';
    END IF;
END
$$;

-- Ensure timeframe column has no NULLs before enforcing NOT NULL
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'pair_timeframes'
          AND column_name = 'timeframe'
    ) THEN
        IF NOT EXISTS (SELECT 1 FROM public."pair_timeframes" WHERE "timeframe" IS NULL) THEN
            EXECUTE 'ALTER TABLE public."pair_timeframes" ALTER COLUMN "timeframe" SET NOT NULL';
        END IF;
    END IF;
END
$$;

-- Ensure the unique index on (symbol, timeframe) exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'pair_timeframes_symbol_timeframe_unique'
    ) THEN
        EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS pair_timeframes_symbol_timeframe_unique ON public."pair_timeframes" ("symbol", "timeframe")';
    END IF;
END
$$;

-- Add the trading pair trading limit columns when missing
ALTER TABLE public."trading_pairs" ADD COLUMN IF NOT EXISTS "min_qty" numeric(18, 8);
ALTER TABLE public."trading_pairs" ADD COLUMN IF NOT EXISTS "min_notional" numeric(18, 8);
ALTER TABLE public."trading_pairs" ADD COLUMN IF NOT EXISTS "step_size" numeric(18, 8);
ALTER TABLE public."trading_pairs" ADD COLUMN IF NOT EXISTS "tick_size" numeric(18, 8);
