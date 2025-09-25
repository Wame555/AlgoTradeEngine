DO $$
BEGIN
  IF to_regclass('public.user_settings') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_settings_user_id_unique'
      AND conrelid = 'public.user_settings'::regclass
  ) THEN
    BEGIN
      EXECUTE 'ALTER TABLE public.user_settings RENAME CONSTRAINT user_settings_user_id_unique TO user_settings_user_id_uniq';
    EXCEPTION
      WHEN duplicate_object THEN
        NULL;
    END;
  END IF;
END $$;
