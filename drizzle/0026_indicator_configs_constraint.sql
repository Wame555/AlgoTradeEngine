DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_indicator_configs_user_name'
  ) THEN
    EXECUTE 'DROP INDEX public.idx_indicator_configs_user_name';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'indicator_configs_user_id_name_uniq'
      AND conrelid = 'public.indicator_configs'::regclass
  ) THEN
    ALTER TABLE public."indicator_configs"
      ADD CONSTRAINT indicator_configs_user_id_name_uniq UNIQUE ("user_id", "name");
  END IF;
END $$;
