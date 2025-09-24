-- Update user_settings with demo trading defaults
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "demo_enabled" boolean DEFAULT true;
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "default_tp_pct" numeric(5, 2) DEFAULT 1.00;
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "default_sl_pct" numeric(5, 2) DEFAULT 0.50;

UPDATE "user_settings"
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
    ALTER TABLE "indicator_configs" RENAME COLUMN "params" TO "payload";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'indicator_configs' AND column_name = 'enabled'
  ) THEN
    ALTER TABLE "indicator_configs" DROP COLUMN "enabled";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'indicator_configs' AND column_name = 'updated_at'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'indicator_configs' AND column_name = 'created_at'
    ) THEN
      UPDATE indicator_configs
      SET created_at = COALESCE(created_at, updated_at);
      ALTER TABLE "indicator_configs" DROP COLUMN "updated_at";
    ELSE
      ALTER TABLE "indicator_configs" RENAME COLUMN "updated_at" TO "created_at";
    END IF;
  END IF;
END$$;

ALTER TABLE "indicator_configs" ADD COLUMN IF NOT EXISTS "user_id" varchar;
ALTER TABLE "indicator_configs" ADD COLUMN IF NOT EXISTS "payload" jsonb DEFAULT '{}'::jsonb;
ALTER TABLE "indicator_configs" ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT now();

DO $$
DECLARE
  default_user_id varchar;
BEGIN
  SELECT id INTO default_user_id FROM users ORDER BY created_at LIMIT 1;

  IF default_user_id IS NULL THEN
    default_user_id := gen_random_uuid();
    INSERT INTO users (id, username, password) VALUES (default_user_id, 'demo', 'demo')
    ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password RETURNING id INTO default_user_id;
  END IF;

  UPDATE indicator_configs
  SET user_id = COALESCE(user_id, default_user_id),
      created_at = COALESCE(created_at, now());

  ALTER TABLE indicator_configs ALTER COLUMN user_id SET NOT NULL;
END $$;

DROP INDEX IF EXISTS indicator_configs_name_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_indicator_configs_user_name
  ON indicator_configs(user_id, name);

-- Restructure closed_positions to new schema
ALTER TABLE "closed_positions" ADD COLUMN IF NOT EXISTS "user_id" varchar;
ALTER TABLE "closed_positions" ADD COLUMN IF NOT EXISTS "size" numeric(18, 8);
ALTER TABLE "closed_positions" ADD COLUMN IF NOT EXISTS "entry_price" numeric(18, 8);
ALTER TABLE "closed_positions" ADD COLUMN IF NOT EXISTS "exit_price" numeric(18, 8);
ALTER TABLE "closed_positions" ADD COLUMN IF NOT EXISTS "fee_usd" numeric(18, 8) DEFAULT 0;
ALTER TABLE "closed_positions" ADD COLUMN IF NOT EXISTS "opened_at" timestamptz;
ALTER TABLE "closed_positions" ADD COLUMN IF NOT EXISTS "closed_at" timestamptz;

DO $$
DECLARE
  default_user_id varchar;
BEGIN
  SELECT id INTO default_user_id FROM users ORDER BY created_at LIMIT 1;
  UPDATE closed_positions
  SET
    size = COALESCE(size, qty),
    entry_price = COALESCE(entry_price, entry_px),
    exit_price = COALESCE(exit_price, exit_px),
    fee_usd = COALESCE(fee_usd, fee, 0),
    opened_at = COALESCE(opened_at, entry_ts, now()),
    closed_at = COALESCE(closed_at, exit_ts, now()),
    user_id = COALESCE(user_id, default_user_id)
  WHERE TRUE;

  ALTER TABLE closed_positions ALTER COLUMN size SET NOT NULL;
  ALTER TABLE closed_positions ALTER COLUMN entry_price SET NOT NULL;
  ALTER TABLE closed_positions ALTER COLUMN exit_price SET NOT NULL;
  ALTER TABLE closed_positions ALTER COLUMN fee_usd SET DEFAULT 0;
  ALTER TABLE closed_positions ALTER COLUMN fee_usd SET NOT NULL;
  ALTER TABLE closed_positions ALTER COLUMN opened_at SET NOT NULL;
  ALTER TABLE closed_positions ALTER COLUMN closed_at SET NOT NULL;
  ALTER TABLE closed_positions ALTER COLUMN pnl_usd SET DEFAULT 0;
  ALTER TABLE closed_positions ALTER COLUMN pnl_usd SET NOT NULL;
  ALTER TABLE closed_positions ALTER COLUMN user_id SET NOT NULL;
END $$;

ALTER TABLE "closed_positions" DROP COLUMN IF EXISTS "entry_ts";
ALTER TABLE "closed_positions" DROP COLUMN IF EXISTS "exit_ts";
ALTER TABLE "closed_positions" DROP COLUMN IF EXISTS "entry_px";
ALTER TABLE "closed_positions" DROP COLUMN IF EXISTS "exit_px";
ALTER TABLE "closed_positions" DROP COLUMN IF EXISTS "qty";
ALTER TABLE "closed_positions" DROP COLUMN IF EXISTS "fee";

CREATE INDEX IF NOT EXISTS idx_closed_positions_symbol_time
  ON closed_positions(symbol, closed_at);

CREATE INDEX IF NOT EXISTS idx_closed_positions_user
  ON closed_positions(user_id);
