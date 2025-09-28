-- drizzle/0020_positions_request_and_status.sql
-- Idempotent guards for request_id uniqueness and pipeline fields

ALTER TABLE public."positions"
  ADD COLUMN IF NOT EXISTS request_id text,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS side text,
  ADD COLUMN IF NOT EXISTS order_type text,
  ADD COLUMN IF NOT EXISTS price numeric,
  ADD COLUMN IF NOT EXISTS quantity numeric;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_positions_request_id'
  ) THEN
    DROP INDEX idx_positions_request_id;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'positions_request_id_uniq'
      AND conrelid = 'public.positions'::regclass
  ) THEN
    ALTER TABLE public."positions"
      ADD CONSTRAINT positions_request_id_uniq UNIQUE (request_id);
  END IF;
END $$;
