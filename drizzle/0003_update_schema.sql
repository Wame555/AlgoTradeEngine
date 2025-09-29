-- Update user_settings with demo trading defaults
ALTER TABLE public."user_settings" ADD COLUMN IF NOT EXISTS "demo_enabled" boolean DEFAULT true;
ALTER TABLE public."user_settings" ADD COLUMN IF NOT EXISTS "default_tp_pct" numeric(5, 2) DEFAULT 1.00;
ALTER TABLE public."user_settings" ADD COLUMN IF NOT EXISTS "default_sl_pct" numeric(5, 2) DEFAULT 0.50;

UPDATE public."user_settings"
SET
  demo_enabled = COALESCE(demo_enabled, true),
  default_tp_pct = COALESCE(default_tp_pct, 1.00),
  default_sl_pct = COALESCE(default_sl_pct, 0.50)
WHERE TRUE;

-- Restructure indicator_configs to support per-user payloads
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'indicator_configs' AND column_name = 'params'
  ) THEN
    ALTER TABLE public."indicator_configs" RENAME COLUMN "params" TO "payload";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'indicator_configs' AND column_name = 'enabled'
  ) THEN
    ALTER TABLE public."indicator_configs" DROP COLUMN "enabled";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'indicator_configs' AND column_name = 'updated_at'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'indicator_configs' AND column_name = 'created_at'
    ) THEN
      UPDATE public."indicator_configs"
      SET "created_at" = COALESCE("created_at", "updated_at");
      ALTER TABLE public."indicator_configs" DROP COLUMN "updated_at";
    ELSE
      ALTER TABLE public."indicator_configs" RENAME COLUMN "updated_at" TO "created_at";
    END IF;
  END IF;
END $$;

ALTER TABLE public."indicator_configs" ADD COLUMN IF NOT EXISTS "user_id" uuid;
ALTER TABLE public."indicator_configs" ADD COLUMN IF NOT EXISTS "payload" jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public."indicator_configs" ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT now();

DO $$
DECLARE
  default_user_id uuid;
  default_username text := COALESCE(NULLIF(current_setting('algo.default_user', true), ''), 'demo');
  default_password text := COALESCE(NULLIF(current_setting('algo.default_password', true), ''), 'demo');
BEGIN
  SELECT id INTO default_user_id FROM public."users" WHERE "username" = default_username LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO public."users" ("id", "username", "password", "created_at")
    VALUES (gen_random_uuid(), default_username, default_password, now())
    ON CONFLICT ON CONSTRAINT users_username_uniq DO UPDATE SET password = EXCLUDED.password
    RETURNING id INTO default_user_id;
  END IF;

  UPDATE public."indicator_configs"
  SET "user_id" = COALESCE("user_id", default_user_id),
      "created_at" = COALESCE("created_at", now());

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'indicator_configs' AND column_name = 'user_id'
  ) THEN
    EXECUTE 'ALTER TABLE public."indicator_configs" ALTER COLUMN "user_id" SET NOT NULL';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'indicator_configs_name_unique'
  ) THEN
    DROP INDEX public.indicator_configs_name_unique;
  END IF;
END $$;

-- Restructure closed_positions to new schema
ALTER TABLE public."closed_positions" ADD COLUMN IF NOT EXISTS "user_id" uuid;
ALTER TABLE public."closed_positions" ADD COLUMN IF NOT EXISTS "size" numeric(18, 8);
ALTER TABLE public."closed_positions" ADD COLUMN IF NOT EXISTS "entry_price" numeric(18, 8);
ALTER TABLE public."closed_positions" ADD COLUMN IF NOT EXISTS "exit_price" numeric(18, 8);
ALTER TABLE public."closed_positions" ADD COLUMN IF NOT EXISTS "pl" numeric(18, 8);
ALTER TABLE public."closed_positions" ADD COLUMN IF NOT EXISTS "fee" numeric(18, 8);
ALTER TABLE public."closed_positions" ADD COLUMN IF NOT EXISTS "duration_min" integer;
ALTER TABLE public."closed_positions" ADD COLUMN IF NOT EXISTS "strategy" text;
ALTER TABLE public."closed_positions" ADD COLUMN IF NOT EXISTS "notes" text;

DO $$
DECLARE
  default_user_id uuid;
  default_username text := COALESCE(NULLIF(current_setting('algo.default_user', true), ''), 'demo');
BEGIN
  SELECT id INTO default_user_id FROM public."users" WHERE "username" = default_username LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public."closed_positions"
  SET "user_id" = COALESCE("user_id", default_user_id);

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'closed_positions' AND column_name = 'user_id'
  ) THEN
    EXECUTE 'ALTER TABLE public."closed_positions" ALTER COLUMN "user_id" SET NOT NULL';
  END IF;
END $$;

-- Add indexes for new schema
CREATE INDEX IF NOT EXISTS idx_closed_positions_symbol_time ON public."closed_positions"("symbol", "closed_at");
CREATE INDEX IF NOT EXISTS idx_closed_positions_user ON public."closed_positions"("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS idx_indicator_configs_user_name ON public."indicator_configs"("user_id", "name");
