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
END$$;

ALTER TABLE public."indicator_configs" ADD COLUMN IF NOT EXISTS "user_id" varchar;
ALTER TABLE public."indicator_configs" ADD COLUMN IF NOT EXISTS "payload" jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public."indicator_configs" ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT now();

DO $$
DECLARE
  default_user_id varchar;
BEGIN
  SELECT id INTO default_user_id FROM public."users" ORDER BY created_at LIMIT 1;

  IF default_user_id IS NULL THEN
    default_user_id := gen_random_uuid();
    INSERT INTO public."users" (id, username, password) VALUES (default_user_id, 'demo', 'demo')
    ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password RETURNING id INTO default_user_id;
  END IF;

  UPDATE public."indicator_configs"
  SET user_id = COALESCE(user_id, default_user_id),
      created_at = COALESCE(created_at, now());

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'indicator_configs'
      AND column_name = 'user_id'
  ) THEN
    EXECUTE 'ALTER TABLE public."indicator_configs" ALTER COLUMN "user_id" SET NOT NULL';
  END IF;
END $$;

DROP INDEX IF EXISTS public.indicator_configs_name_unique;

CREATE UNIQUE INDEX IF NOT EXISTS public.idx_indicator_configs_user_name
  ON public."indicator_configs"("user_id", "name");

-- Restructure closed_positions to new schema
ALTER TABLE public."closed_positions" ADD COLUMN IF NOT EXISTS "user_id" varchar;
ALTER TABLE public."closed_positions" ADD COLUMN IF NOT EXISTS "size" numeric(18, 8);
ALTER TABLE public."closed_positions" ADD COLUMN IF NOT EXISTS "entry_price" numeric(18, 8);
ALTER TABLE public."closed_positions" ADD COLUMN IF NOT EXISTS "exit_price" numeric(18, 8);
ALTER TABLE public."closed_positions" ADD COLUMN IF NOT EXISTS "fee_usd" numeric(18, 8) DEFAULT 0;
ALTER TABLE public."closed_positions" ADD COLUMN IF NOT EXISTS "opened_at" timestamptz;
ALTER TABLE public."closed_positions" ADD COLUMN IF NOT EXISTS "closed_at" timestamptz;

DO $$
DECLARE
  default_user_id varchar;
  has_qty boolean;
  has_entry_px boolean;
  has_exit_px boolean;
  has_fee boolean;
  has_entry_ts boolean;
  has_exit_ts boolean;
BEGIN
  SELECT id INTO default_user_id FROM public."users" ORDER BY created_at LIMIT 1;

  IF default_user_id IS NULL THEN
    default_user_id := gen_random_uuid();
    INSERT INTO public."users" (id, username, password) VALUES (default_user_id, 'demo', 'demo')
    ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password RETURNING id INTO default_user_id;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'closed_positions' AND column_name = 'qty'
  ) INTO has_qty;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'closed_positions' AND column_name = 'entry_px'
  ) INTO has_entry_px;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'closed_positions' AND column_name = 'exit_px'
  ) INTO has_exit_px;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'closed_positions' AND column_name = 'fee'
  ) INTO has_fee;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'closed_positions' AND column_name = 'entry_ts'
  ) INTO has_entry_ts;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'closed_positions' AND column_name = 'exit_ts'
  ) INTO has_exit_ts;

  IF has_qty THEN
    EXECUTE 'UPDATE public."closed_positions" SET "size" = COALESCE("size", "qty")';
  END IF;

  IF has_entry_px THEN
    EXECUTE 'UPDATE public."closed_positions" SET "entry_price" = COALESCE("entry_price", "entry_px")';
  END IF;

  IF has_exit_px THEN
    EXECUTE 'UPDATE public."closed_positions" SET "exit_price" = COALESCE("exit_price", "exit_px")';
  END IF;

  IF has_fee THEN
    EXECUTE 'UPDATE public."closed_positions" SET "fee_usd" = COALESCE("fee_usd", "fee", 0)';
  ELSE
    EXECUTE 'UPDATE public."closed_positions" SET "fee_usd" = COALESCE("fee_usd", 0)';
  END IF;

  IF has_entry_ts THEN
    EXECUTE 'UPDATE public."closed_positions" SET "opened_at" = COALESCE("opened_at", "entry_ts", now())';
  ELSE
    EXECUTE 'UPDATE public."closed_positions" SET "opened_at" = COALESCE("opened_at", now())';
  END IF;

  IF has_exit_ts THEN
    EXECUTE 'UPDATE public."closed_positions" SET "closed_at" = COALESCE("closed_at", "exit_ts", now())';
  ELSE
    EXECUTE 'UPDATE public."closed_positions" SET "closed_at" = COALESCE("closed_at", now())';
  END IF;

  EXECUTE 'UPDATE public."closed_positions" SET "pnl_usd" = COALESCE("pnl_usd", 0)';
  EXECUTE 'UPDATE public."closed_positions" SET "user_id" = COALESCE("user_id", $1)' USING default_user_id;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'closed_positions' AND column_name = 'size'
  ) THEN
    EXECUTE 'ALTER TABLE public."closed_positions" ALTER COLUMN "size" SET NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'closed_positions' AND column_name = 'entry_price'
  ) THEN
    EXECUTE 'ALTER TABLE public."closed_positions" ALTER COLUMN "entry_price" SET NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'closed_positions' AND column_name = 'exit_price'
  ) THEN
    EXECUTE 'ALTER TABLE public."closed_positions" ALTER COLUMN "exit_price" SET NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'closed_positions' AND column_name = 'fee_usd'
  ) THEN
    EXECUTE 'ALTER TABLE public."closed_positions" ALTER COLUMN "fee_usd" SET DEFAULT 0';
    EXECUTE 'ALTER TABLE public."closed_positions" ALTER COLUMN "fee_usd" SET NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'closed_positions' AND column_name = 'opened_at'
  ) THEN
    EXECUTE 'ALTER TABLE public."closed_positions" ALTER COLUMN "opened_at" SET NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'closed_positions' AND column_name = 'closed_at'
  ) THEN
    EXECUTE 'ALTER TABLE public."closed_positions" ALTER COLUMN "closed_at" SET NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'closed_positions' AND column_name = 'pnl_usd'
  ) THEN
    EXECUTE 'ALTER TABLE public."closed_positions" ALTER COLUMN "pnl_usd" SET DEFAULT 0';
    EXECUTE 'ALTER TABLE public."closed_positions" ALTER COLUMN "pnl_usd" SET NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'closed_positions' AND column_name = 'user_id'
  ) THEN
    EXECUTE 'ALTER TABLE public."closed_positions" ALTER COLUMN "user_id" SET NOT NULL';
  END IF;
END $$;

ALTER TABLE public."closed_positions" DROP COLUMN IF EXISTS "entry_ts";
ALTER TABLE public."closed_positions" DROP COLUMN IF EXISTS "exit_ts";
ALTER TABLE public."closed_positions" DROP COLUMN IF EXISTS "entry_px";
ALTER TABLE public."closed_positions" DROP COLUMN IF EXISTS "exit_px";
ALTER TABLE public."closed_positions" DROP COLUMN IF EXISTS "qty";
ALTER TABLE public."closed_positions" DROP COLUMN IF EXISTS "fee";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_closed_positions_symbol_time'
      AND indexdef NOT LIKE '%("time")%'
  ) THEN
    EXECUTE 'DROP INDEX IF EXISTS public.idx_closed_positions_symbol_time';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'closed_positions'
      AND column_name = 'time'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS public.idx_closed_positions_symbol_time ON public.closed_positions(symbol, "time")';
  END IF;
END$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'closed_positions'
      AND column_name = 'user_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS public.idx_closed_positions_user ON public."closed_positions"("user_id")';
  END IF;
END$$;
