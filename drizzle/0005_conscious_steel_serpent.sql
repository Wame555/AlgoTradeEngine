-- Intentionally left as a no-op placeholder to keep drizzle journal in sync after
-- aligning the TypeScript schema with manual migrations. Real guard logic lives in
-- earlier migrations and drizzle/9999_guard.sql.
DO $$
BEGIN
  RETURN;
END$$;
