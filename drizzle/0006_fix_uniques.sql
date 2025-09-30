-- Normalize uniques: use named UNIQUE CONSTRAINTs (…_uniq), drop legacy unique INDEXes.
-- Idempotent and safe on re-run.

-- 1) positions.request_id → positions_request_id_uniq (drop legacy index if present)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='idx_positions_request_id'
  ) THEN
    DROP INDEX idx_positions_request_id;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='positions_request_id_uniq'
      AND conrelid='public.positions'::regclass
  ) THEN
    ALTER TABLE public."positions" ADD CONSTRAINT positions_request_id_uniq UNIQUE (request_id);
  END IF;
END $$;

-- 2) pair_timeframes (symbol,timeframe) → pair_timeframes_symbol_timeframe_uniq
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='pair_timeframes_symbol_timeframe_unique'
  ) THEN
    DROP INDEX pair_timeframes_symbol_timeframe_unique;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='pair_timeframes_symbol_timeframe_uniq'
      AND conrelid='public.pair_timeframes'::regclass
  ) THEN
    ALTER TABLE public."pair_timeframes" ADD CONSTRAINT pair_timeframes_symbol_timeframe_uniq UNIQUE (symbol, timeframe);
  END IF;
END $$;

-- 3) users.username → users_username_uniq (tidy up legacy naming if exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='users_username_unique'
      AND conrelid='public.users'::regclass
  ) THEN
    ALTER TABLE public."users" DROP CONSTRAINT users_username_unique;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='users_username_unique'
  ) THEN
    DROP INDEX public."users_username_unique";
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='users_username_uniq'
      AND conrelid='public.users'::regclass
  ) THEN
    ALTER TABLE public."users" ADD CONSTRAINT users_username_uniq UNIQUE ("username");
  END IF;
END $$;
