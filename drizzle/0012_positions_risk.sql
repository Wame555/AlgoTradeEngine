ALTER TABLE public."positions" ADD COLUMN IF NOT EXISTS "qty" numeric(18, 8);
ALTER TABLE public."positions" ADD COLUMN IF NOT EXISTS "tp_price" numeric(18, 8);
ALTER TABLE public."positions" ADD COLUMN IF NOT EXISTS "sl_price" numeric(18, 8);
ALTER TABLE public."positions" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now();

UPDATE public."positions"
SET "qty" = CASE
  WHEN "qty" IS NULL
       AND "entry_price" IS NOT NULL
       AND "entry_price" <> 0
       AND "size" IS NOT NULL
  THEN ROUND("size" / NULLIF("entry_price", 0), 8)
  ELSE "qty"
END
WHERE "qty" IS NULL
  AND "entry_price" IS NOT NULL
  AND "entry_price" <> 0
  AND "size" IS NOT NULL;

UPDATE public."positions"
SET "updated_at" = COALESCE("updated_at", "opened_at", now());

CREATE INDEX IF NOT EXISTS idx_positions_tp ON public."positions" ("tp_price");
CREATE INDEX IF NOT EXISTS idx_positions_sl ON public."positions" ("sl_price");
