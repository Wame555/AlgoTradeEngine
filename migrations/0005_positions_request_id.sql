BEGIN;

ALTER TABLE positions ADD COLUMN IF NOT EXISTS request_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_positions_request_id
  ON positions (request_id)
  WHERE request_id IS NOT NULL;

COMMIT;
