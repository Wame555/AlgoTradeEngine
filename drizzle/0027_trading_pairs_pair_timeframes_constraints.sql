-- Align trading_pairs and pair_timeframes unique constraints with naming conventions

DO $$
BEGIN
  IF to_regclass('public.trading_pairs_symbol_unique') IS NOT NULL THEN
    EXECUTE 'DROP INDEX public.trading_pairs_symbol_unique';
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'trading_pairs_symbol_unique'
      AND conrelid = 'public.trading_pairs'::regclass
  ) THEN
    ALTER TABLE public."trading_pairs"
      RENAME CONSTRAINT trading_pairs_symbol_unique TO trading_pairs_symbol_uniq;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'trading_pairs_symbol_uniq'
      AND conrelid = 'public.trading_pairs'::regclass
  ) THEN
    ALTER TABLE public."trading_pairs"
      ADD CONSTRAINT trading_pairs_symbol_uniq UNIQUE (symbol);
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.pair_timeframes_symbol_timeframe_unique') IS NOT NULL THEN
    EXECUTE 'DROP INDEX public.pair_timeframes_symbol_timeframe_unique';
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pair_timeframes_symbol_timeframe_unique'
      AND conrelid = 'public.pair_timeframes'::regclass
  ) THEN
    ALTER TABLE public."pair_timeframes"
      RENAME CONSTRAINT pair_timeframes_symbol_timeframe_unique TO pair_timeframes_symbol_timeframe_uniq;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pair_timeframes_symbol_timeframe_uniq'
      AND conrelid = 'public.pair_timeframes'::regclass
  ) THEN
    ALTER TABLE public."pair_timeframes"
      ADD CONSTRAINT pair_timeframes_symbol_timeframe_uniq UNIQUE (symbol, timeframe);
  END IF;
END
$$;
