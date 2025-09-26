ALTER TABLE indicator_configs ADD COLUMN IF NOT EXISTS type text;
UPDATE indicator_configs SET type = COALESCE(type, 'GENERIC');
ALTER TABLE indicator_configs ALTER COLUMN type SET DEFAULT 'GENERIC';
ALTER TABLE indicator_configs ALTER COLUMN type SET NOT NULL;
