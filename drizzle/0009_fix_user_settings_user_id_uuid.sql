DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
    CREATE EXTENSION "pgcrypto";
  END IF;

  IF to_regclass('public.user_settings') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_settings'
      AND column_name = 'user_id'
      AND data_type IN ('character varying', 'text')
  ) THEN
    ALTER TABLE public.user_settings
      ALTER COLUMN user_id TYPE uuid USING user_id::uuid;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_settings_user_id_uniq'
      AND conrelid = 'public.user_settings'::regclass
  ) THEN
    IF EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'user_settings'
        AND indexname = 'user_settings_user_id_uniq'
    ) THEN
      ALTER TABLE public.user_settings
        ADD CONSTRAINT user_settings_user_id_uniq UNIQUE USING INDEX user_settings_user_id_uniq;
    ELSE
      ALTER TABLE public.user_settings
        ADD CONSTRAINT user_settings_user_id_uniq UNIQUE (user_id);
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.users') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'email'
  ) THEN
    ALTER TABLE public.users ADD COLUMN email varchar(255);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'email'
      AND data_type NOT IN ('character varying', 'text')
  ) THEN
    ALTER TABLE public.users ALTER COLUMN email TYPE varchar(255);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass
      AND conname = 'users_email_uniq'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'users'
        AND indexname = 'users_email_uniq'
    ) THEN
      ALTER TABLE public.users
        ADD CONSTRAINT users_email_uniq UNIQUE USING INDEX users_email_uniq;
    ELSE
      ALTER TABLE public.users
        ADD CONSTRAINT users_email_uniq UNIQUE (email);
    END IF;
  END IF;
END $$;
