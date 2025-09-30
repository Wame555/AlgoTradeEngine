-- drizzle/0019_positions_request_id_uniq.sql
-- Idempotens migráció a positions.request_id és az egyedi CONSTRAINT biztosításához

-- 1) Oszlop hozzáadása, ha hiányzik
ALTER TABLE public."positions"
  ADD COLUMN IF NOT EXISTS request_id text;

-- 2) Régi (részleges) egyedi INDEX eltávolítása, ha létezik
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_positions_request_id'
  ) THEN
    DROP INDEX idx_positions_request_id;
  END IF;
END $$;

-- 3) Egyedi CONSTRAINT létrehozása guard-dal (NEM index!)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'positions_request_id_uniq'
      AND conrelid = 'public.positions'::regclass
  ) THEN
    ALTER TABLE public."positions"
      ADD CONSTRAINT positions_request_id_uniq UNIQUE (request_id);
  END IF;
END $$;
