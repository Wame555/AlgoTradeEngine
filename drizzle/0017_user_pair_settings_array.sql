DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='user_pair_settings' AND column_name='active_timeframes'
  ) THEN
    ALTER TABLE public."user_pair_settings" ADD COLUMN active_timeframes TEXT[] DEFAULT '{}'::text[];
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='user_pair_settings_user_symbol_uniq'
  ) THEN
    ALTER TABLE public."user_pair_settings" ADD CONSTRAINT user_pair_settings_user_symbol_uniq UNIQUE ("user_id","symbol");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_pair_settings_user ON public."user_pair_settings" ("user_id");
CREATE INDEX IF NOT EXISTS idx_user_pair_settings_symbol ON public."user_pair_settings" ("symbol");
CREATE INDEX IF NOT EXISTS idx_market_data_sym_tf_ts ON public."market_data" ("symbol","timeframe","ts");
