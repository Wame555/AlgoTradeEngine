ALTER TABLE public."positions" ADD COLUMN IF NOT EXISTS "qty" numeric(18, 8) NOT NULL DEFAULT 0;
ALTER TABLE public."positions" ADD COLUMN IF NOT EXISTS "tp_price" numeric(18, 8);
ALTER TABLE public."positions" ADD COLUMN IF NOT EXISTS "sl_price" numeric(18, 8);
ALTER TABLE public."positions" ADD COLUMN IF NOT EXISTS "leverage" numeric(10, 2) NOT NULL DEFAULT 1;
ALTER TABLE public."positions" ADD COLUMN IF NOT EXISTS "amount_usd" numeric(18, 2);

ALTER TABLE public."user_settings" ADD COLUMN IF NOT EXISTS "total_balance" numeric(18, 2) NOT NULL DEFAULT 10000;

UPDATE public."positions"
SET "qty" = ROUND("size" / NULLIF("entry_price", 0), 8)
WHERE ("qty" = 0 OR "qty" IS NULL)
  AND "size" IS NOT NULL
  AND "entry_price" IS NOT NULL
  AND "entry_price" <> 0;

UPDATE public."positions"
SET "amount_usd" = "size"
WHERE "amount_usd" IS NULL
  AND "size" IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_positions_user ON public."positions" ("user_id");
CREATE INDEX IF NOT EXISTS idx_market_data_sym_tf_ts ON public."market_data" ("symbol", "timeframe", "ts");
