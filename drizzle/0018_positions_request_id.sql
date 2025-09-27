ALTER TABLE public."positions" ADD COLUMN IF NOT EXISTS qty numeric(18,8) NOT NULL DEFAULT 0;
ALTER TABLE public."positions" ADD COLUMN IF NOT EXISTS tp_price numeric(18,8);
ALTER TABLE public."positions" ADD COLUMN IF NOT EXISTS sl_price numeric(18,8);
ALTER TABLE public."positions" ADD COLUMN IF NOT EXISTS request_id text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_positions_request_id ON public."positions"(request_id) WHERE request_id IS NOT NULL;

ALTER TABLE public."user_settings" ADD COLUMN IF NOT EXISTS initial_balance numeric(18,2) DEFAULT 10000;
