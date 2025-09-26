export const SYMBOL_LIST = (process.env.SYMBOL_LIST ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0);
export const FUTURES = process.env.FUTURES === "true";
export const RUN_MIGRATIONS_ON_START = process.env.RUN_MIGRATIONS_ON_START === "true";
export const BACKFILL_ON_START = process.env.BACKFILL_ON_START === "true";

const DEFAULT_BACKFILL_TIMEFRAMES = ["1m", "3m", "5m", "15m", "1h", "4h", "1d", "1w", "1M"] as const;

function parseBackfillTimeframes(): string[] {
  const raw = process.env.BACKFILL_TIMEFRAMES ?? '';
  const parsed = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (parsed.length === 0) {
    return [...DEFAULT_BACKFILL_TIMEFRAMES];
  }

  const allowed = new Set(DEFAULT_BACKFILL_TIMEFRAMES.map((tf) => tf));
  return parsed.filter((tf) => allowed.has(tf as (typeof DEFAULT_BACKFILL_TIMEFRAMES)[number]));
}

function parseBackfillMinCandles(): number {
  const raw = process.env.BACKFILL_MIN_CANDLES;
  const parsed = raw != null ? Number.parseInt(raw, 10) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return 400;
}

export const BACKFILL_TIMEFRAMES = parseBackfillTimeframes();
export const BACKFILL_MIN_CANDLES = parseBackfillMinCandles();

export const PAPER_TRADING = (process.env.PAPER_TRADING ?? 'true') === 'true';
export const DEMO_ENABLED = (process.env.DEMO_ENABLED ?? 'true') === 'true';
export const TELEGRAM_ENABLED = (process.env.TELEGRAM_ENABLED ?? 'false') === 'true';
