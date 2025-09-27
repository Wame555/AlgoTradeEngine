CREATE INDEX IF NOT EXISTS idx_market_data_sym_tf_ts ON public."market_data"("symbol", "timeframe", "ts");
