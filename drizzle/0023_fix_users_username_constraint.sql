-- Fix constraint name to conform with naming convention

-- Drop old wrongly named UNIQUE constraint if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'users_username_unique'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public."users" DROP CONSTRAINT users_username_unique;
  END IF;
END $$;

-- Also drop legacy unique index if it exists (guarded)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE schemaname='public' AND indexname='users_username_unique'
  ) THEN
    DROP INDEX public."users_username_unique";
  END IF;
END $$;

-- Create the canonical UNIQUE constraint if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'users_username_uniq'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public."users" ADD CONSTRAINT users_username_uniq UNIQUE ("username");
  END IF;
END $$;
