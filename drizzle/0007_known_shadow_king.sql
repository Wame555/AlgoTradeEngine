DO $$
DECLARE
  canonical_constraint text := 'user_settings_user_id_unique';
  rename_target text := 'user_settings_user_id_unique_idx';
  existing_constraint text;
  constraint_exists boolean;
  index_name text;
  index_attached boolean;
BEGIN
  IF to_regclass('public.user_settings') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS demo_enabled boolean DEFAULT true';
  EXECUTE 'ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS default_tp_pct numeric(5, 2) DEFAULT 1.00';
  EXECUTE 'ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS default_sl_pct numeric(5, 2) DEFAULT 0.50';

  EXECUTE 'UPDATE public.user_settings SET demo_enabled = true WHERE demo_enabled IS NULL';
  EXECUTE 'UPDATE public.user_settings SET default_tp_pct = ''1.00'' WHERE default_tp_pct IS NULL';
  EXECUTE 'UPDATE public.user_settings SET default_sl_pct = ''0.50'' WHERE default_sl_pct IS NULL';
  EXECUTE 'DELETE FROM public.user_settings WHERE user_id IS NULL';

  EXECUTE '
    WITH ranked AS (
      SELECT id,
             row_number() OVER (
               PARTITION BY user_id
               ORDER BY updated_at DESC NULLS LAST,
                        created_at DESC NULLS LAST,
                        id ASC
             ) AS rn
      FROM public.user_settings
    )
    DELETE FROM public.user_settings us
    USING ranked r
    WHERE us.id = r.id AND r.rn > 1;
  ';

  SELECT tc.constraint_name
  INTO existing_constraint
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema = kcu.table_schema
   AND tc.table_name = kcu.table_name
  WHERE tc.table_schema = 'public'
    AND tc.table_name = 'user_settings'
    AND tc.constraint_type = 'UNIQUE'
  GROUP BY tc.constraint_name
  HAVING array_agg(lower(kcu.column_name) ORDER BY kcu.ordinal_position) = ARRAY['user_id']
  LIMIT 1;

  IF existing_constraint IS NOT NULL THEN
    IF existing_constraint <> canonical_constraint THEN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'user_settings'
          AND c.conname = canonical_constraint
      ) THEN
        BEGIN
          EXECUTE format(
            'ALTER TABLE public.user_settings RENAME CONSTRAINT %I TO %I',
            existing_constraint,
            canonical_constraint
          );
        EXCEPTION
          WHEN duplicate_object THEN
            NULL;
        END;
      END IF;
    END IF;
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'user_settings'
      AND c.conname = canonical_constraint
  ) INTO constraint_exists;

  IF constraint_exists THEN
    RETURN;
  END IF;

  SELECT i.relname,
         EXISTS (
           SELECT 1
           FROM pg_constraint con
           WHERE con.conindid = i.oid
             AND con.contype = 'u'
         )
  INTO index_name, index_attached
  FROM pg_class i
  JOIN pg_namespace n ON n.oid = i.relnamespace
  WHERE n.nspname = 'public'
    AND i.relname = canonical_constraint
    AND i.relkind = 'i'
  LIMIT 1;

  IF index_name IS NOT NULL AND NOT index_attached THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class idx
      JOIN pg_namespace ns ON ns.oid = idx.relnamespace
      WHERE ns.nspname = 'public'
        AND idx.relname = rename_target
        AND idx.relkind = 'i'
    ) THEN
      BEGIN
        EXECUTE format('ALTER INDEX public.%I RENAME TO %I', index_name, rename_target);
        index_name := rename_target;
      EXCEPTION
        WHEN duplicate_object THEN
          NULL;
      END;
    END IF;
  END IF;

  IF index_name IS NULL OR index_attached THEN
    SELECT info.index_name
    INTO index_name
    FROM (
      SELECT
        i.relname AS index_name,
        array_agg(lower(a.attname) ORDER BY k.ordinality) AS columns,
        bool_or(con.conname IS NOT NULL) AS is_attached
      FROM pg_class t
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_index ix ON ix.indrelid = t.oid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ordinality) ON TRUE
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      LEFT JOIN pg_constraint con ON con.conindid = i.oid AND con.contype = 'u'
      WHERE n.nspname = 'public'
        AND t.relname = 'user_settings'
        AND ix.indisunique
        AND ix.indpred IS NULL
      GROUP BY i.relname
    ) info
    WHERE info.columns = ARRAY['user_id']
      AND info.is_attached = false
    LIMIT 1;
  END IF;

  IF index_name IS NOT NULL THEN
    BEGIN
      EXECUTE format(
        'ALTER TABLE public.user_settings ADD CONSTRAINT %I UNIQUE USING INDEX %I',
        canonical_constraint,
        index_name
      );
    EXCEPTION
      WHEN duplicate_object THEN
        NULL;
    END;
  ELSE
    BEGIN
      EXECUTE 'ALTER TABLE public.user_settings ADD CONSTRAINT user_settings_user_id_unique UNIQUE (user_id)';
    EXCEPTION
      WHEN duplicate_object THEN
        NULL;
    END;
  END IF;
END $$;

DO $$
DECLARE
  has_timeframe boolean;
BEGIN
  EXECUTE '
    CREATE TABLE IF NOT EXISTS public.pair_timeframes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      symbol text,
      timeframe text,
      created_at timestamptz DEFAULT now()
    )
  ';

  has_timeframe := EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pair_timeframes'
      AND column_name = 'timeframe'
  );

  IF NOT has_timeframe THEN
    EXECUTE 'ALTER TABLE public.pair_timeframes ADD COLUMN timeframe text';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pair_timeframes'
      AND column_name = 'tf'
  ) THEN
    EXECUTE 'UPDATE public.pair_timeframes SET timeframe = tf WHERE timeframe IS NULL AND tf IS NOT NULL';
    EXECUTE 'ALTER TABLE public.pair_timeframes DROP COLUMN IF EXISTS tf';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.pair_timeframes WHERE timeframe IS NULL) THEN
    EXECUTE 'ALTER TABLE public.pair_timeframes ALTER COLUMN timeframe SET NOT NULL';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.pair_timeframes WHERE symbol IS NULL) THEN
    EXECUTE 'ALTER TABLE public.pair_timeframes ALTER COLUMN symbol SET NOT NULL';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.pair_timeframes') IS NOT NULL THEN
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS pair_timeframes_symbol_timeframe_unique ON public.pair_timeframes(symbol, timeframe)';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.closed_positions') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_closed_positions_symbol_time ON public.closed_positions(symbol, closed_at)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_closed_positions_user ON public.closed_positions(user_id)';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.indicator_configs') IS NOT NULL THEN
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_indicator_configs_user_name ON public.indicator_configs(user_id, name)';
  END IF;
END $$;
