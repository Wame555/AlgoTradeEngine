CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
DECLARE
  v_pk_name text;
  v_pk_is_on_id boolean;
  v_unique_name text;
  v_default_username text;
  v_default_password text;
BEGIN
  v_default_username := COALESCE(NULLIF(current_setting('algo.default_user', true), ''), 'demo');
  v_default_password := COALESCE(NULLIF(current_setting('algo.default_user_password', true), ''), 'demo');

  IF to_regclass('public.user_settings') IS NULL THEN
    RAISE NOTICE '[0004] table public.user_settings missing, skipping user_settings guard.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_settings'
      AND column_name = 'id'
  ) THEN
    EXECUTE 'ALTER TABLE public.user_settings ADD COLUMN id uuid';
  ELSIF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_settings'
      AND column_name = 'id'
      AND data_type <> 'uuid'
  ) THEN
    EXECUTE 'ALTER TABLE public.user_settings ALTER COLUMN id TYPE uuid USING id::uuid';
  END IF;

  EXECUTE 'UPDATE public.user_settings SET id = COALESCE(id, gen_random_uuid())';
  EXECUTE 'ALTER TABLE public.user_settings ALTER COLUMN id SET DEFAULT gen_random_uuid()';
  EXECUTE 'ALTER TABLE public.user_settings ALTER COLUMN id SET NOT NULL';

  SELECT constraint_name,
         bool_and(column_name = 'id') AS is_on_id
  INTO v_pk_name, v_pk_is_on_id
  FROM (
    SELECT tc.constraint_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'user_settings'
      AND tc.constraint_type = 'PRIMARY KEY'
  ) sub
  GROUP BY constraint_name
  LIMIT 1;

  IF v_pk_name IS NOT NULL AND NOT v_pk_is_on_id THEN
    EXECUTE format('ALTER TABLE public.user_settings DROP CONSTRAINT %I', v_pk_name);
    v_pk_name := NULL;
  END IF;

  IF v_pk_name IS NULL THEN
    EXECUTE 'ALTER TABLE public.user_settings ADD CONSTRAINT user_settings_pkey PRIMARY KEY (id)';
  END IF;

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
      WHERE user_id IS NOT NULL
    )
    DELETE FROM public.user_settings us
    USING ranked r
    WHERE us.id = r.id AND r.rn > 1
  ';

  EXECUTE 'DELETE FROM public.user_settings WHERE user_id IS NULL';

  SELECT tc.constraint_name
  INTO v_unique_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema = kcu.table_schema
  WHERE tc.table_schema = 'public'
    AND tc.table_name = 'user_settings'
    AND tc.constraint_type = 'UNIQUE'
    AND kcu.column_name = 'user_id'
  LIMIT 1;

  IF v_unique_name IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'user_settings'
        AND indexname IN ('user_settings_user_id_unique', 'user_settings_user_id_uniq_idx', 'idx_user_settings_user_id')
    ) THEN
      EXECUTE 'ALTER TABLE public.user_settings ADD CONSTRAINT user_settings_user_id_uniq UNIQUE USING INDEX user_settings_user_id_unique';
    ELSE
      EXECUTE 'ALTER TABLE public.user_settings ADD CONSTRAINT user_settings_user_id_uniq UNIQUE (user_id)';
    END IF;
  ELSIF v_unique_name <> 'user_settings_user_id_uniq' THEN
    EXECUTE format(
      'ALTER TABLE public.user_settings RENAME CONSTRAINT %I TO user_settings_user_id_uniq',
      v_unique_name
    );
  END IF;

  EXECUTE 'ALTER TABLE public.user_settings ALTER COLUMN user_id SET NOT NULL';

  IF to_regclass('public.users') IS NULL THEN
    RAISE NOTICE '[0004] table public.users missing, skipping default user seed.';
    RETURN;
  END IF;

  EXECUTE '
    INSERT INTO public.users (id, username, password)
    VALUES (gen_random_uuid(), $1, $2)
    ON CONFLICT ON CONSTRAINT users_username_uniq DO UPDATE SET username = EXCLUDED.username
  ' USING v_default_username, v_default_password;

  EXECUTE '
    INSERT INTO public.user_settings (
      id,
      user_id,
      is_testnet,
      default_leverage,
      risk_percent,
      demo_enabled,
      default_tp_pct,
      default_sl_pct
    )
    SELECT gen_random_uuid(), u.id, true, 1, 2, true, ''1.00'', ''0.50''
    FROM public.users u
    LEFT JOIN public.user_settings s ON s.user_id = u.id
    WHERE s.id IS NULL
  ';
END $$;
