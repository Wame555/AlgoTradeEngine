DO $$
DECLARE
  current_name text;
BEGIN
  IF to_regclass('public.users') IS NULL THEN
    RETURN;
  END IF;

  SELECT con.conname
  INTO current_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace ns ON ns.oid = rel.relnamespace
  WHERE ns.nspname = 'public'
    AND rel.relname = 'users'
    AND con.contype = 'u'
    AND (
      SELECT array_agg(att.attname ORDER BY cols.ordinality)
      FROM unnest(con.conkey) WITH ORDINALITY AS cols(attnum, ordinality)
      JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = cols.attnum
    ) = ARRAY['username']
  LIMIT 1;

  IF current_name IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'users'
        AND indexname = 'users_username_unique'
    ) THEN
      EXECUTE 'ALTER TABLE public.users ADD CONSTRAINT users_username_uniq UNIQUE USING INDEX users_username_unique';
    ELSE
      EXECUTE 'ALTER TABLE public.users ADD CONSTRAINT users_username_uniq UNIQUE (username)';
    END IF;
  ELSIF current_name <> 'users_username_uniq' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'users_username_uniq'
        AND contype = 'u'
    ) THEN
      EXECUTE format('ALTER TABLE public.users RENAME CONSTRAINT %I TO users_username_uniq', current_name);
    END IF;
  END IF;
END $$;

DO $$
DECLARE
  existing_constraint text;
  index_name text;
  attached_constraint text;
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

  SELECT con.conname
  INTO existing_constraint
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace ns ON ns.oid = rel.relnamespace
  WHERE ns.nspname = 'public'
    AND rel.relname = 'user_settings'
    AND con.contype = 'u'
    AND (
      SELECT array_agg(att.attname ORDER BY cols.ordinality)
      FROM unnest(con.conkey) WITH ORDINALITY AS cols(attnum, ordinality)
      JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = cols.attnum
    ) = ARRAY['user_id']
  LIMIT 1;

  IF existing_constraint IS NOT NULL THEN
    IF existing_constraint <> 'user_settings_user_id_uniq' THEN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'user_settings_user_id_uniq'
          AND contype = 'u'
      ) THEN
        EXECUTE format('ALTER TABLE public.user_settings RENAME CONSTRAINT %I TO user_settings_user_id_uniq', existing_constraint);
      END IF;
    END IF;
    RETURN;
  END IF;

  SELECT idx.relname,
         con.conname
  INTO index_name, attached_constraint
  FROM pg_class idx
  JOIN pg_namespace ns ON ns.oid = idx.relnamespace
  LEFT JOIN pg_constraint con ON con.conindid = idx.oid AND con.contype = 'u'
  WHERE ns.nspname = 'public'
    AND idx.relname IN ('user_settings_user_id_unique', 'user_settings_user_id_unique_idx', 'idx_user_settings_user_id')
    AND idx.relkind = 'i'
  ORDER BY idx.relname
  LIMIT 1;

  IF index_name IS NOT NULL AND attached_constraint IS NULL THEN
    BEGIN
      EXECUTE format('ALTER TABLE public.user_settings ADD CONSTRAINT user_settings_user_id_uniq UNIQUE USING INDEX %I', index_name);
      RETURN;
    EXCEPTION
      WHEN duplicate_object THEN
        NULL;
    END;
  END IF;

  EXECUTE 'ALTER TABLE public.user_settings ADD CONSTRAINT user_settings_user_id_uniq UNIQUE (user_id)';
END $$;

DO $$
DECLARE
  existing_constraint text;
  index_name text;
  attached_constraint text;
BEGIN
  IF to_regclass('public.indicator_configs') IS NULL THEN
    RETURN;
  END IF;

  SELECT con.conname
  INTO existing_constraint
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace ns ON ns.oid = rel.relnamespace
  WHERE ns.nspname = 'public'
    AND rel.relname = 'indicator_configs'
    AND con.contype = 'u'
    AND (
      SELECT array_agg(att.attname ORDER BY cols.ordinality)
      FROM unnest(con.conkey) WITH ORDINALITY AS cols(attnum, ordinality)
      JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = cols.attnum
    ) = ARRAY['user_id', 'name']
  LIMIT 1;

  IF existing_constraint IS NOT NULL THEN
    IF existing_constraint <> 'indicator_configs_user_id_name_uniq' THEN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'indicator_configs_user_id_name_uniq'
      ) THEN
        EXECUTE format('ALTER TABLE public.indicator_configs RENAME CONSTRAINT %I TO indicator_configs_user_id_name_uniq', existing_constraint);
      END IF;
    END IF;
    RETURN;
  END IF;

  SELECT idx.relname,
         con.conname
  INTO index_name, attached_constraint
  FROM pg_class idx
  JOIN pg_namespace ns ON ns.oid = idx.relnamespace
  LEFT JOIN pg_constraint con ON con.conindid = idx.oid AND con.contype = 'u'
  WHERE ns.nspname = 'public'
    AND idx.relname IN ('idx_indicator_configs_user_name', 'indicator_configs_name_unique', 'idx_indicator_configs_user_id_name')
    AND idx.relkind = 'i'
  ORDER BY idx.relname
  LIMIT 1;

  IF index_name IS NOT NULL AND attached_constraint IS NULL THEN
    BEGIN
      EXECUTE format('ALTER TABLE public.indicator_configs ADD CONSTRAINT indicator_configs_user_id_name_uniq UNIQUE USING INDEX %I', index_name);
      RETURN;
    EXCEPTION
      WHEN duplicate_object THEN
        NULL;
    END;
  END IF;

  EXECUTE 'ALTER TABLE public.indicator_configs ADD CONSTRAINT indicator_configs_user_id_name_uniq UNIQUE (user_id, name)';
END $$;

DO $$
DECLARE
  has_timeframe boolean;
  legacy_index text;
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
    EXECUTE 'UPDATE public.pair_timeframes SET timeframe = COALESCE(timeframe, tf)';
    EXECUTE 'ALTER TABLE public.pair_timeframes DROP COLUMN IF EXISTS tf';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.pair_timeframes WHERE timeframe IS NULL) THEN
    EXECUTE 'ALTER TABLE public.pair_timeframes ALTER COLUMN timeframe SET NOT NULL';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.pair_timeframes WHERE symbol IS NULL) THEN
    EXECUTE 'ALTER TABLE public.pair_timeframes ALTER COLUMN symbol SET NOT NULL';
  END IF;

  SELECT con.conname
  INTO legacy_index
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace ns ON ns.oid = rel.relnamespace
  WHERE ns.nspname = 'public'
    AND rel.relname = 'pair_timeframes'
    AND con.contype = 'u'
    AND (
      SELECT array_agg(att.attname ORDER BY cols.ordinality)
      FROM unnest(con.conkey) WITH ORDINALITY AS cols(attnum, ordinality)
      JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = cols.attnum
    ) = ARRAY['symbol', 'timeframe']
  LIMIT 1;

  IF legacy_index IS NOT NULL THEN
    IF legacy_index <> 'pair_timeframes_symbol_timeframe_uniq' THEN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'pair_timeframes_symbol_timeframe_uniq'
      ) THEN
        EXECUTE format('ALTER TABLE public.pair_timeframes RENAME CONSTRAINT %I TO pair_timeframes_symbol_timeframe_uniq', legacy_index);
      END IF;
    END IF;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'pair_timeframes'
      AND indexname = 'pair_timeframes_symbol_timeframe_unique'
  ) THEN
    BEGIN
      EXECUTE 'ALTER TABLE public.pair_timeframes ADD CONSTRAINT pair_timeframes_symbol_timeframe_uniq UNIQUE USING INDEX pair_timeframes_symbol_timeframe_unique';
      RETURN;
    EXCEPTION
      WHEN duplicate_object THEN
        NULL;
    END;
  END IF;

  EXECUTE 'ALTER TABLE public.pair_timeframes ADD CONSTRAINT pair_timeframes_symbol_timeframe_uniq UNIQUE (symbol, timeframe)';
END $$;

DO $$
DECLARE
  existing_constraint text;
BEGIN
  IF to_regclass('public.trading_pairs') IS NULL THEN
    RETURN;
  END IF;

  SELECT con.conname
  INTO existing_constraint
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace ns ON ns.oid = rel.relnamespace
  WHERE ns.nspname = 'public'
    AND rel.relname = 'trading_pairs'
    AND con.contype = 'u'
    AND (
      SELECT array_agg(att.attname ORDER BY cols.ordinality)
      FROM unnest(con.conkey) WITH ORDINALITY AS cols(attnum, ordinality)
      JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = cols.attnum
    ) = ARRAY['symbol']
  LIMIT 1;

  IF existing_constraint IS NOT NULL THEN
    IF existing_constraint <> 'trading_pairs_symbol_uniq' THEN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'trading_pairs_symbol_uniq'
      ) THEN
        EXECUTE format('ALTER TABLE public.trading_pairs RENAME CONSTRAINT %I TO trading_pairs_symbol_uniq', existing_constraint);
      END IF;
    END IF;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'trading_pairs'
      AND indexname = 'trading_pairs_symbol_unique'
  ) THEN
    BEGIN
      EXECUTE 'ALTER TABLE public.trading_pairs ADD CONSTRAINT trading_pairs_symbol_uniq UNIQUE USING INDEX trading_pairs_symbol_unique';
      RETURN;
    EXCEPTION
      WHEN duplicate_object THEN
        NULL;
    END;
  END IF;

  EXECUTE 'ALTER TABLE public.trading_pairs ADD CONSTRAINT trading_pairs_symbol_uniq UNIQUE (symbol)';
END $$;

DO $$
DECLARE
  existing_constraint text;
BEGIN
  IF to_regclass('public.market_data') IS NULL THEN
    RETURN;
  END IF;

  SELECT con.conname
  INTO existing_constraint
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace ns ON ns.oid = rel.relnamespace
  WHERE ns.nspname = 'public'
    AND rel.relname = 'market_data'
    AND con.contype = 'u'
    AND (
      SELECT array_agg(att.attname ORDER BY cols.ordinality)
      FROM unnest(con.conkey) WITH ORDINALITY AS cols(attnum, ordinality)
      JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = cols.attnum
    ) = ARRAY['symbol', 'timeframe']
  LIMIT 1;

  IF existing_constraint IS NOT NULL THEN
    IF existing_constraint <> 'market_data_symbol_timeframe_uniq' THEN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'market_data_symbol_timeframe_uniq'
      ) THEN
        EXECUTE format('ALTER TABLE public.market_data RENAME CONSTRAINT %I TO market_data_symbol_timeframe_uniq', existing_constraint);
      END IF;
    END IF;
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.market_data ADD CONSTRAINT market_data_symbol_timeframe_uniq UNIQUE (symbol, timeframe)';
END $$;
