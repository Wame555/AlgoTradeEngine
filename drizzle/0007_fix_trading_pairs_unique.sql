-- Normalize trading_pairs unique on (symbol) to canonical constraint name.
-- Safe to re-run.

-- Drop wrongly named UNIQUE CONSTRAINT, if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trading_pairs_symbol_unique'
      AND conrelid = 'public.trading_pairs'::regclass
  ) THEN
    ALTER TABLE public."trading_pairs" DROP CONSTRAINT trading_pairs_symbol_unique;
  END IF;
END $$;

-- Drop legacy UNIQUE INDEX, if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'trading_pairs_symbol_unique'
  ) THEN
    DROP INDEX public."trading_pairs_symbol_unique";
  END IF;
END $$;

-- Ensure correct UNIQUE CONSTRAINT name exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trading_pairs_symbol_uniq'
      AND conrelid = 'public.trading_pairs'::regclass
  ) THEN
    ALTER TABLE public."trading_pairs"
      ADD CONSTRAINT trading_pairs_symbol_uniq UNIQUE ("symbol");
  END IF;
END $$;
