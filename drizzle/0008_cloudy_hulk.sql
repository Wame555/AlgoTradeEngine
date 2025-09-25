CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
BEGIN
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
END $$;

DO $$
BEGIN
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
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_settings'
      AND column_name = 'id'
  ) THEN
    EXECUTE 'ALTER TABLE public.user_settings ALTER COLUMN id SET DEFAULT gen_random_uuid()';
    EXECUTE 'UPDATE public.user_settings SET id = gen_random_uuid() WHERE id IS NULL';
    EXECUTE 'ALTER TABLE public.user_settings ALTER COLUMN id SET NOT NULL';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_settings'
      AND column_name = 'user_id'
  ) THEN
    EXECUTE 'DELETE FROM public.user_settings WHERE user_id IS NULL';
    EXECUTE 'ALTER TABLE public.user_settings ALTER COLUMN user_id SET NOT NULL';
  END IF;
END $$;

DO $$
DECLARE
  legacy_constraint text;
BEGIN
  SELECT conname
  INTO legacy_constraint
  FROM pg_constraint
  WHERE connamespace = 'public'::regnamespace
    AND conrelid = 'public.user_settings'::regclass
    AND contype = 'u'
    AND conname = 'user_settings_user_id_unique'
  LIMIT 1;

  IF legacy_constraint IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.user_settings RENAME CONSTRAINT user_settings_user_id_unique TO user_settings_user_id_uniq';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_settings_user_id_uniq'
      AND conrelid = 'public.user_settings'::regclass
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'user_settings_user_id_unique'
    ) THEN
      EXECUTE 'ALTER INDEX public.user_settings_user_id_unique RENAME TO user_settings_user_id_uniq';
      EXECUTE 'ALTER TABLE public.user_settings ADD CONSTRAINT user_settings_user_id_uniq UNIQUE USING INDEX user_settings_user_id_uniq';
    ELSIF EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'user_settings_user_id_unique_idx'
    ) THEN
      EXECUTE 'ALTER INDEX public.user_settings_user_id_unique_idx RENAME TO user_settings_user_id_uniq';
      EXECUTE 'ALTER TABLE public.user_settings ADD CONSTRAINT user_settings_user_id_uniq UNIQUE USING INDEX user_settings_user_id_uniq';
    ELSIF EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'user_settings_user_id_uniq'
    ) THEN
      EXECUTE 'ALTER TABLE public.user_settings ADD CONSTRAINT user_settings_user_id_uniq UNIQUE USING INDEX user_settings_user_id_uniq';
    ELSE
      EXECUTE 'ALTER TABLE public.user_settings ADD CONSTRAINT user_settings_user_id_uniq UNIQUE (user_id)';
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'user_settings_user_id_uniq_idx'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'user_settings_user_id_uniq'
        AND conrelid = 'public.user_settings'::regclass
    ) THEN
      EXECUTE 'ALTER TABLE public.user_settings ADD CONSTRAINT user_settings_user_id_uniq UNIQUE USING INDEX user_settings_user_id_uniq_idx';
    END IF;
  END IF;
END $$;
