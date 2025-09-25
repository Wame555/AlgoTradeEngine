DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_indicator_configs_user_name'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_indicator_configs_user_name ON public.indicator_configs(user_id, name)';
  END IF;
END$$;
