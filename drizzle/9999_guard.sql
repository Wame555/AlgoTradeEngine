DO $$
DECLARE
  existing_constraint text;
BEGIN
  IF to_regclass('public.user_settings') IS NULL THEN
    RETURN;
  END IF;

  SELECT c.conname
  INTO existing_constraint
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE c.contype = 'u'
    AND n.nspname = 'public'
    AND t.relname = 'user_settings'
    AND EXISTS (
      SELECT 1
      FROM pg_attribute a
      WHERE a.attrelid = c.conrelid
        AND a.attnum = ANY (c.conkey)
        AND a.attname = 'user_id'
    )
  LIMIT 1;

  IF existing_constraint IS NULL THEN
    EXECUTE 'ALTER TABLE public.user_settings ADD CONSTRAINT user_settings_user_id_unique UNIQUE (user_id)';
  ELSIF existing_constraint <> 'user_settings_user_id_unique' THEN
    EXECUTE format(
      'ALTER TABLE public.user_settings RENAME CONSTRAINT %I TO user_settings_user_id_unique',
      existing_constraint
    );
  END IF;
END$$;

DO $$
DECLARE
  current_definition text;
BEGIN
  IF to_regclass('public.closed_positions') IS NULL THEN
    RETURN;
  END IF;

  SELECT indexdef
  INTO current_definition
  FROM pg_indexes
  WHERE schemaname = 'public' AND indexname = 'idx_closed_positions_symbol_time';

  IF current_definition IS NULL
     OR current_definition NOT ILIKE 'CREATE%INDEX%ON public.closed_positions% (symbol, closed_at)%' THEN
    EXECUTE 'DROP INDEX IF EXISTS public.idx_closed_positions_symbol_time';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_closed_positions_symbol_time ON public.closed_positions(symbol, closed_at)';
  END IF;

  SELECT indexdef
  INTO current_definition
  FROM pg_indexes
  WHERE schemaname = 'public' AND indexname = 'idx_closed_positions_user';

  IF current_definition IS NULL
     OR current_definition NOT ILIKE 'CREATE%INDEX%ON public.closed_positions% (user_id)%' THEN
    EXECUTE 'DROP INDEX IF EXISTS public.idx_closed_positions_user';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_closed_positions_user ON public.closed_positions(user_id)';
  END IF;
END$$;

DO $$
DECLARE
  current_definition text;
BEGIN
  IF to_regclass('public.indicator_configs') IS NULL THEN
    RETURN;
  END IF;

  SELECT indexdef
  INTO current_definition
  FROM pg_indexes
  WHERE schemaname = 'public' AND indexname = 'idx_indicator_configs_user_name';

  IF current_definition IS NULL
     OR current_definition NOT ILIKE 'CREATE%UNIQUE%INDEX%ON public.indicator_configs% (user_id, name)%' THEN
    EXECUTE 'DROP INDEX IF EXISTS public.idx_indicator_configs_user_name';
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_indicator_configs_user_name ON public.indicator_configs(user_id, name)';
  END IF;
END$$;
