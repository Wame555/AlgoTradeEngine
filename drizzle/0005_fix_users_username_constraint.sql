-- Rename users username unique constraint for naming convention
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'users_username_unique'
    ) THEN
        ALTER TABLE public."users" DROP CONSTRAINT users_username_unique;
    END IF;
END $$;

DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'users_username_unique'
    ) THEN
        DROP INDEX public."users_username_unique";
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'users_username_uniq'
    ) THEN
        ALTER TABLE public."users" ADD CONSTRAINT users_username_uniq UNIQUE ("username");
    END IF;
END $$;
