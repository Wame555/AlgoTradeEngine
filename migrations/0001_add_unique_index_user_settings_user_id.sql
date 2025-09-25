-- Remove potential duplicate user settings records before enforcing uniqueness
DELETE FROM "user_settings" a
USING "user_settings" b
WHERE a.ctid < b.ctid
  AND a.user_id = b.user_id;

-- Enforce unique user_id values for user settings
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_settings_user_id_uniq'
  ) THEN
    ALTER TABLE "user_settings"
      ADD CONSTRAINT "user_settings_user_id_uniq" UNIQUE ("user_id");
  END IF;
END $$;
