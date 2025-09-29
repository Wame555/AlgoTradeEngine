-- Ensure closed_positions schema matches application expectations
ALTER TABLE public."closed_positions" ADD COLUMN IF NOT EXISTS "opened_at" timestamp with time zone;
ALTER TABLE public."closed_positions" ADD COLUMN IF NOT EXISTS "closed_at" timestamp with time zone;
ALTER TABLE public."closed_positions" ADD COLUMN IF NOT EXISTS "fee_usd" numeric(18, 8) DEFAULT 0;
ALTER TABLE public."closed_positions" ADD COLUMN IF NOT EXISTS "size" numeric(18, 8);
ALTER TABLE public."closed_positions" ADD COLUMN IF NOT EXISTS "entry_price" numeric(18, 8);
ALTER TABLE public."closed_positions" ADD COLUMN IF NOT EXISTS "exit_price" numeric(18, 8);
ALTER TABLE public."closed_positions" ADD COLUMN IF NOT EXISTS "pl" numeric(18, 8);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'closed_positions' AND column_name = 'entry_ts'
  ) THEN
    UPDATE public."closed_positions"
    SET "opened_at" = COALESCE("opened_at", "entry_ts");
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'closed_positions' AND column_name = 'exit_ts'
  ) THEN
    UPDATE public."closed_positions"
    SET "closed_at" = COALESCE("closed_at", "exit_ts");
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'closed_positions' AND column_name = 'qty'
  ) THEN
    UPDATE public."closed_positions"
    SET "size" = COALESCE("size", "qty");
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'closed_positions' AND column_name = 'entry_px'
  ) THEN
    UPDATE public."closed_positions"
    SET "entry_price" = COALESCE("entry_price", "entry_px");
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'closed_positions' AND column_name = 'exit_px'
  ) THEN
    UPDATE public."closed_positions"
    SET "exit_price" = COALESCE("exit_price", "exit_px");
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'closed_positions' AND column_name = 'fee'
  ) THEN
    UPDATE public."closed_positions"
    SET "fee_usd" = COALESCE("fee_usd", "fee", 0);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'closed_positions' AND column_name = 'pnl_usd'
  ) THEN
    UPDATE public."closed_positions"
    SET "pl" = COALESCE("pl", "pnl_usd");
  END IF;
END $$;

UPDATE public."closed_positions"
SET "opened_at" = COALESCE("opened_at", "closed_at", now())
WHERE "opened_at" IS NULL;

UPDATE public."closed_positions"
SET "closed_at" = COALESCE("closed_at", "opened_at", now())
WHERE "closed_at" IS NULL;

UPDATE public."closed_positions"
SET "size" = COALESCE("size", 0)
WHERE "size" IS NULL;

UPDATE public."closed_positions"
SET "entry_price" = COALESCE("entry_price", 0)
WHERE "entry_price" IS NULL;

UPDATE public."closed_positions"
SET "exit_price" = COALESCE("exit_price", 0)
WHERE "exit_price" IS NULL;

UPDATE public."closed_positions"
SET "fee_usd" = COALESCE("fee_usd", 0)
WHERE "fee_usd" IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'closed_positions' AND column_name = 'opened_at'
  ) THEN
    ALTER TABLE public."closed_positions" ALTER COLUMN "opened_at" SET NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'closed_positions' AND column_name = 'closed_at'
  ) THEN
    ALTER TABLE public."closed_positions" ALTER COLUMN "closed_at" SET NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'closed_positions' AND column_name = 'size'
  ) THEN
    ALTER TABLE public."closed_positions" ALTER COLUMN "size" SET NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'closed_positions' AND column_name = 'entry_price'
  ) THEN
    ALTER TABLE public."closed_positions" ALTER COLUMN "entry_price" SET NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'closed_positions' AND column_name = 'exit_price'
  ) THEN
    ALTER TABLE public."closed_positions" ALTER COLUMN "exit_price" SET NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'closed_positions' AND column_name = 'fee_usd'
  ) THEN
    ALTER TABLE public."closed_positions" ALTER COLUMN "fee_usd" SET NOT NULL;
    ALTER TABLE public."closed_positions" ALTER COLUMN "fee_usd" SET DEFAULT 0;
  END IF;
END $$;

-- Ensure system_state table exists for account snapshots
CREATE TABLE IF NOT EXISTS public."system_state" (
    "id" integer PRIMARY KEY DEFAULT 1,
    "total_balance" numeric(18, 8) NOT NULL,
    "equity" numeric(18, 8) NOT NULL,
    "updated_at" timestamp DEFAULT now()
);
