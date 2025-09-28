-- drizzle/0021_unique_naming_conventions.sql
-- Align unique constraint names with project conventions

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'users_username_unique'
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_username_unique'
      AND conrelid = 'public.users'::regclass
  ) THEN
    DROP INDEX public.users_username_unique;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_username_unique'
      AND conrelid = 'public.users'::regclass
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_username_uniq'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public."users"
      RENAME CONSTRAINT users_username_unique TO users_username_uniq;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_username_uniq'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public."users"
      ADD CONSTRAINT users_username_uniq UNIQUE (username);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'trading_pairs_symbol_unique'
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trading_pairs_symbol_unique'
      AND conrelid = 'public.trading_pairs'::regclass
  ) THEN
    DROP INDEX public.trading_pairs_symbol_unique;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trading_pairs_symbol_unique'
      AND conrelid = 'public.trading_pairs'::regclass
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trading_pairs_symbol_uniq'
      AND conrelid = 'public.trading_pairs'::regclass
  ) THEN
    ALTER TABLE public."trading_pairs"
      RENAME CONSTRAINT trading_pairs_symbol_unique TO trading_pairs_symbol_uniq;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trading_pairs_symbol_uniq'
      AND conrelid = 'public.trading_pairs'::regclass
  ) THEN
    ALTER TABLE public."trading_pairs"
      ADD CONSTRAINT trading_pairs_symbol_uniq UNIQUE (symbol);
  END IF;
END $$;

