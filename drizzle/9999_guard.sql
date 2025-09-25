DO $$
DECLARE
  existing_constraint text;
  matching_index text;
  canonical_index text := 'user_settings_user_id_uniq';
  canonical_regclass regclass;
BEGIN
  IF to_regclass('public.user_settings') IS NULL THEN
    RAISE NOTICE '[9999] table public.user_settings missing, skipping user_settings constraint guard.';
    RETURN;
  END IF;

  SELECT tc.constraint_name
  INTO existing_constraint
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema = kcu.table_schema
  WHERE tc.table_schema = 'public'
    AND tc.table_name = 'user_settings'
    AND tc.constraint_type = 'UNIQUE'
    AND kcu.column_name = 'user_id'
  LIMIT 1;

  IF existing_constraint IS NOT NULL THEN
    IF existing_constraint <> canonical_index THEN
      BEGIN
        EXECUTE format(
          'ALTER TABLE public.user_settings RENAME CONSTRAINT %I TO %I',
          existing_constraint,
          canonical_index
        );
      EXCEPTION
        WHEN duplicate_object THEN
          NULL;
      END;
    END IF;
    RETURN;
  END IF;

  SELECT i.relname
  INTO matching_index
  FROM pg_class t
  JOIN pg_namespace n ON n.oid = t.relnamespace
  JOIN pg_index ix ON ix.indrelid = t.oid
  JOIN pg_class i ON i.oid = ix.indexrelid
  JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ordinality) ON TRUE
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
  WHERE n.nspname = 'public'
    AND t.relname = 'user_settings'
    AND ix.indisunique
    AND ix.indpred IS NULL
  GROUP BY i.relname
  HAVING array_agg(lower(a.attname) ORDER BY k.ordinality) = ARRAY['user_id']
  LIMIT 1;

  IF matching_index IS NULL THEN
    matching_index := 'idx_user_settings_user_id';
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_user_settings_user_id ON public.user_settings(user_id)';
  END IF;

  BEGIN
    EXECUTE format(
      'ALTER TABLE public.user_settings ADD CONSTRAINT %I UNIQUE USING INDEX %I',
      canonical_index,
      matching_index
    );
  EXCEPTION
    WHEN duplicate_object THEN
      NULL;
  END;

  SELECT to_regclass('public.' || canonical_index)
  INTO canonical_regclass;

  IF canonical_regclass IS NULL AND matching_index <> canonical_index THEN
    BEGIN
      EXECUTE format(
        'ALTER INDEX public.%I RENAME TO %I',
        matching_index,
        canonical_index
      );
    EXCEPTION
      WHEN duplicate_object THEN
        NULL;
    END;
  END IF;
END$$;

DO $$
DECLARE
  has_symbol_time boolean;
  has_user boolean;
BEGIN
  IF to_regclass('public.closed_positions') IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_class i
    JOIN pg_namespace n ON n.oid = i.relnamespace
    JOIN pg_index ix ON ix.indexrelid = i.oid
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ordinality) ON TRUE
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
    WHERE n.nspname = 'public'
      AND t.relname = 'closed_positions'
      AND i.relname = 'idx_closed_positions_symbol_time'
      AND ix.indpred IS NULL
    GROUP BY i.relname
    HAVING array_agg(lower(a.attname) ORDER BY k.ordinality) = ARRAY['symbol', 'closed_at']
  ) INTO has_symbol_time;

  IF NOT has_symbol_time THEN
    EXECUTE 'DROP INDEX IF EXISTS public.idx_closed_positions_symbol_time';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_closed_positions_symbol_time ON public.closed_positions(symbol, closed_at)';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_class i
    JOIN pg_namespace n ON n.oid = i.relnamespace
    JOIN pg_index ix ON ix.indexrelid = i.oid
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ordinality) ON TRUE
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
    WHERE n.nspname = 'public'
      AND t.relname = 'closed_positions'
      AND i.relname = 'idx_closed_positions_user'
      AND ix.indpred IS NULL
    GROUP BY i.relname
    HAVING array_agg(lower(a.attname) ORDER BY k.ordinality) = ARRAY['user_id']
  ) INTO has_user;

  IF NOT has_user THEN
    EXECUTE 'DROP INDEX IF EXISTS public.idx_closed_positions_user';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_closed_positions_user ON public.closed_positions(user_id)';
  END IF;
END$$;

DO $$
DECLARE
  has_indicator_index boolean;
BEGIN
  IF to_regclass('public.indicator_configs') IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_class i
    JOIN pg_namespace n ON n.oid = i.relnamespace
    JOIN pg_index ix ON ix.indexrelid = i.oid
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ordinality) ON TRUE
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
    WHERE n.nspname = 'public'
      AND t.relname = 'indicator_configs'
      AND i.relname = 'idx_indicator_configs_user_id_name'
      AND ix.indisunique
      AND ix.indpred IS NULL
    GROUP BY i.relname
    HAVING array_agg(lower(a.attname) ORDER BY k.ordinality) = ARRAY['user_id', 'name']
  ) INTO has_indicator_index;

  IF NOT has_indicator_index THEN
    EXECUTE 'DROP INDEX IF EXISTS public.idx_indicator_configs_user_id_name';
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_indicator_configs_user_id_name ON public.indicator_configs(user_id, name)';
  END IF;
END$$;
