DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_pair_settings'
      AND column_name = 'active_timeframes'
  ) THEN
    ALTER TABLE public."user_pair_settings"
      ADD COLUMN IF NOT EXISTS "active_timeframes" text[];
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_pair_settings'
      AND column_name = 'active_timeframes'
  ) THEN
    EXECUTE 'ALTER TABLE public."user_pair_settings" ALTER COLUMN "active_timeframes" SET DEFAULT ARRAY[]::text[]';
    EXECUTE 'UPDATE public."user_pair_settings" SET "active_timeframes" = ARRAY[]::text[] WHERE "active_timeframes" IS NULL';
    EXECUTE 'ALTER TABLE public."user_pair_settings" ALTER COLUMN "active_timeframes" SET NOT NULL';
  END IF;
END $$;
