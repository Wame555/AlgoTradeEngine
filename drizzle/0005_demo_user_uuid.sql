-- Ensures users and user_settings use UUID identifiers and seeds the stable demo user
BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  password text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  telegram_bot_token text,
  telegram_chat_id text,
  binance_api_key text,
  binance_api_secret text,
  is_testnet boolean DEFAULT true,
  default_leverage integer DEFAULT 1,
  risk_percent real DEFAULT 2,
  demo_enabled boolean DEFAULT true,
  default_tp_pct numeric(5, 2) DEFAULT 1.00,
  default_sl_pct numeric(5, 2) DEFAULT 0.50,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'id'
  ) THEN
    EXECUTE 'ALTER TABLE public.users ADD COLUMN id uuid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'id'
      AND data_type <> 'uuid'
  ) THEN
    EXECUTE 'ALTER TABLE public.users ALTER COLUMN id TYPE uuid USING id::uuid';
  END IF;

  EXECUTE 'UPDATE public.users SET id = gen_random_uuid() WHERE id IS NULL';
  EXECUTE 'ALTER TABLE public.users ALTER COLUMN id SET DEFAULT gen_random_uuid()';
  EXECUTE 'ALTER TABLE public.users ALTER COLUMN id SET NOT NULL';
  EXECUTE 'ALTER TABLE public.users ALTER COLUMN username SET NOT NULL';
  EXECUTE 'ALTER TABLE public.users ALTER COLUMN password SET NOT NULL';
END $$;

DO $$
DECLARE
  pk_name text;
  pk_valid boolean;
  unique_name text;
BEGIN
  SELECT tc.constraint_name,
         bool_and(kcu.column_name = 'id')
  INTO pk_name, pk_valid
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema = kcu.table_schema
  WHERE tc.table_schema = 'public'
    AND tc.table_name = 'users'
    AND tc.constraint_type = 'PRIMARY KEY'
  GROUP BY tc.constraint_name;

  IF pk_name IS NOT NULL AND NOT pk_valid THEN
    EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT %I', pk_name);
    pk_name := NULL;
  END IF;

  IF pk_name IS NULL THEN
    EXECUTE 'ALTER TABLE public.users ADD CONSTRAINT users_pkey PRIMARY KEY (id)';
  END IF;

  SELECT tc.constraint_name
  INTO unique_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema = kcu.table_schema
  WHERE tc.table_schema = 'public'
    AND tc.table_name = 'users'
    AND tc.constraint_type = 'UNIQUE'
    AND kcu.column_name = 'username'
  LIMIT 1;

  IF unique_name IS NULL THEN
    EXECUTE 'ALTER TABLE public.users ADD CONSTRAINT users_username_unique UNIQUE (username)';
  ELSIF unique_name <> 'users_username_unique' THEN
    EXECUTE format('ALTER TABLE public.users RENAME CONSTRAINT %I TO users_username_unique', unique_name);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.user_settings') IS NULL THEN
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
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_settings'
      AND column_name = 'id'
      AND data_type <> 'uuid'
  ) THEN
    EXECUTE 'ALTER TABLE public.user_settings ALTER COLUMN id TYPE uuid USING id::uuid';
  END IF;

  EXECUTE 'UPDATE public.user_settings SET id = gen_random_uuid() WHERE id IS NULL';
  EXECUTE 'ALTER TABLE public.user_settings ALTER COLUMN id SET DEFAULT gen_random_uuid()';
  EXECUTE 'ALTER TABLE public.user_settings ALTER COLUMN id SET NOT NULL';

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_settings'
      AND column_name = 'user_id'
  ) THEN
    EXECUTE 'ALTER TABLE public.user_settings ADD COLUMN user_id uuid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_settings'
      AND column_name = 'user_id'
      AND data_type <> 'uuid'
  ) THEN
    EXECUTE 'ALTER TABLE public.user_settings ALTER COLUMN user_id TYPE uuid USING user_id::uuid';
  END IF;

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
    WHERE us.id = r.id AND r.rn > 1
  ';

  EXECUTE 'ALTER TABLE public.user_settings ALTER COLUMN user_id SET NOT NULL';
  EXECUTE 'UPDATE public.user_settings SET created_at = COALESCE(created_at, now())';
  EXECUTE 'UPDATE public.user_settings SET updated_at = COALESCE(updated_at, now())';
  EXECUTE 'ALTER TABLE public.user_settings ALTER COLUMN created_at SET DEFAULT now()';
  EXECUTE 'ALTER TABLE public.user_settings ALTER COLUMN updated_at SET DEFAULT now()';
END $$;

DO $$
DECLARE
  pk_name text;
  pk_valid boolean;
  unique_name text;
  fk_name text;
  fk_delete_rule text;
  fk_table text;
BEGIN
  IF to_regclass('public.user_settings') IS NULL THEN
    RETURN;
  END IF;

  SELECT tc.constraint_name,
         bool_and(kcu.column_name = 'id')
  INTO pk_name, pk_valid
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema = kcu.table_schema
  WHERE tc.table_schema = 'public'
    AND tc.table_name = 'user_settings'
    AND tc.constraint_type = 'PRIMARY KEY'
  GROUP BY tc.constraint_name;

  IF pk_name IS NOT NULL AND NOT pk_valid THEN
    EXECUTE format('ALTER TABLE public.user_settings DROP CONSTRAINT %I', pk_name);
    pk_name := NULL;
  END IF;

  IF pk_name IS NULL THEN
    EXECUTE 'ALTER TABLE public.user_settings ADD CONSTRAINT user_settings_pkey PRIMARY KEY (id)';
  END IF;

  SELECT tc.constraint_name
  INTO unique_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema = kcu.table_schema
  WHERE tc.table_schema = 'public'
    AND tc.table_name = 'user_settings'
    AND tc.constraint_type = 'UNIQUE'
    AND kcu.column_name = 'user_id'
  LIMIT 1;

  IF unique_name IS NULL THEN
    EXECUTE 'ALTER TABLE public.user_settings ADD CONSTRAINT user_settings_user_id_unique UNIQUE (user_id)';
  ELSIF unique_name <> 'user_settings_user_id_unique' THEN
    EXECUTE format('ALTER TABLE public.user_settings RENAME CONSTRAINT %I TO user_settings_user_id_unique', unique_name);
  END IF;

  SELECT rc.constraint_name,
         rc.delete_rule,
         tc2.table_name
  INTO fk_name, fk_delete_rule, fk_table
  FROM information_schema.referential_constraints rc
  JOIN information_schema.table_constraints tc
    ON rc.constraint_name = tc.constraint_name
   AND rc.constraint_schema = tc.constraint_schema
  JOIN information_schema.key_column_usage kcu
    ON kcu.constraint_name = tc.constraint_name
   AND kcu.constraint_schema = tc.constraint_schema
  JOIN information_schema.table_constraints tc2
    ON rc.unique_constraint_name = tc2.constraint_name
   AND rc.unique_constraint_schema = tc2.constraint_schema
  WHERE tc.table_schema = 'public'
    AND tc.table_name = 'user_settings'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND kcu.column_name = 'user_id'
  LIMIT 1;

  IF fk_name IS NOT NULL AND (fk_table <> 'users' OR fk_delete_rule <> 'CASCADE') THEN
    EXECUTE format('ALTER TABLE public.user_settings DROP CONSTRAINT %I', fk_name);
    fk_name := NULL;
  END IF;

  IF fk_name IS NULL THEN
    EXECUTE 'ALTER TABLE public.user_settings ADD CONSTRAINT user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE';
  END IF;
END $$;

DO $$
DECLARE
  demo_id constant uuid := '00000000-0000-0000-0000-000000000001';
BEGIN
  IF to_regclass('public.indicator_configs') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'indicator_configs'
        AND column_name = 'user_id'
    ) THEN
      EXECUTE 'ALTER TABLE public.indicator_configs ADD COLUMN user_id uuid';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'indicator_configs'
        AND column_name = 'user_id'
        AND data_type <> 'uuid'
    ) THEN
      EXECUTE 'ALTER TABLE public.indicator_configs ALTER COLUMN user_id TYPE uuid USING user_id::uuid';
    END IF;

    EXECUTE 'UPDATE public.indicator_configs SET user_id = $1::uuid WHERE user_id IS NULL' USING demo_id;
    EXECUTE 'ALTER TABLE public.indicator_configs ALTER COLUMN user_id SET NOT NULL';
  END IF;

  IF to_regclass('public.positions') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'positions'
        AND column_name = 'user_id'
    ) THEN
      EXECUTE 'ALTER TABLE public.positions ADD COLUMN user_id uuid';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'positions'
        AND column_name = 'user_id'
        AND data_type <> 'uuid'
    ) THEN
      EXECUTE 'ALTER TABLE public.positions ALTER COLUMN user_id TYPE uuid USING user_id::uuid';
    END IF;

    EXECUTE 'UPDATE public.positions SET user_id = $1::uuid WHERE user_id IS NULL' USING demo_id;
    EXECUTE 'ALTER TABLE public.positions ALTER COLUMN user_id SET NOT NULL';
  END IF;

  IF to_regclass('public.closed_positions') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'closed_positions'
        AND column_name = 'user_id'
    ) THEN
      EXECUTE 'ALTER TABLE public.closed_positions ADD COLUMN user_id uuid';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'closed_positions'
        AND column_name = 'user_id'
        AND data_type <> 'uuid'
    ) THEN
      EXECUTE 'ALTER TABLE public.closed_positions ALTER COLUMN user_id TYPE uuid USING user_id::uuid';
    END IF;

    EXECUTE 'UPDATE public.closed_positions SET user_id = $1::uuid WHERE user_id IS NULL' USING demo_id;
    EXECUTE 'ALTER TABLE public.closed_positions ALTER COLUMN user_id SET NOT NULL';
  END IF;
END $$;

DO $$
DECLARE
  demo_id constant uuid := '00000000-0000-0000-0000-000000000001';
  demo_username constant text := 'demo';
  demo_password constant text := 'demo';
  legacy_id uuid;
  has_demo boolean;
BEGIN
  IF to_regclass('public.users') IS NULL THEN
    RETURN;
  END IF;

  SELECT id
  INTO legacy_id
  FROM public.users
  WHERE username = demo_username
  ORDER BY (id = demo_id) DESC, created_at ASC
  LIMIT 1;

  SELECT EXISTS (
    SELECT 1 FROM public.users WHERE id = demo_id
  )
  INTO has_demo;

  IF legacy_id IS NOT NULL AND legacy_id <> demo_id THEN
    IF to_regclass('public.user_settings') IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM public.user_settings WHERE user_id = legacy_id) THEN
        IF EXISTS (SELECT 1 FROM public.user_settings WHERE user_id = demo_id) THEN
          EXECUTE 'DELETE FROM public.user_settings WHERE user_id = $1::uuid' USING legacy_id;
        ELSE
          EXECUTE 'UPDATE public.user_settings SET user_id = $1::uuid WHERE user_id = $2::uuid' USING demo_id, legacy_id;
        END IF;
      END IF;
    END IF;

    IF to_regclass('public.indicator_configs') IS NOT NULL THEN
      EXECUTE 'UPDATE public.indicator_configs SET user_id = $1::uuid WHERE user_id = $2::uuid' USING demo_id, legacy_id;
    END IF;

    IF to_regclass('public.positions') IS NOT NULL THEN
      EXECUTE 'UPDATE public.positions SET user_id = $1::uuid WHERE user_id = $2::uuid' USING demo_id, legacy_id;
    END IF;

    IF to_regclass('public.closed_positions') IS NOT NULL THEN
      EXECUTE 'UPDATE public.closed_positions SET user_id = $1::uuid WHERE user_id = $2::uuid' USING demo_id, legacy_id;
    END IF;

    IF has_demo THEN
      EXECUTE 'DELETE FROM public.users WHERE id = $1::uuid' USING legacy_id;
    ELSE
      EXECUTE 'UPDATE public.users SET id = $1::uuid, username = $2, password = $3 WHERE id = $4::uuid'
        USING demo_id, demo_username, demo_password, legacy_id;
    END IF;
  END IF;

  EXECUTE '
    INSERT INTO public.users (id, username, password)
    VALUES ($1::uuid, $2, $3)
    ON CONFLICT (id) DO UPDATE
      SET username = EXCLUDED.username,
          password = EXCLUDED.password
  ' USING demo_id, demo_username, demo_password;

  IF to_regclass('public.user_settings') IS NOT NULL THEN
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
      SELECT gen_random_uuid(), $1::uuid, true, 1, 2, true, ''1.00'', ''0.50''
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.user_settings
        WHERE user_id = $1::uuid
      )
    ' USING demo_id;
  END IF;
END $$;

COMMIT;
