import { bulkUpsertMarketData, type MarketDataUpsert } from "../db/marketData";
import { BinanceFuturesClient, type BinanceKline, type FuturesTimeframe } from "./binanceClient";
import { CONFIGURED_SYMBOLS } from "../config/symbols";
import { FUTURES, BACKFILL_TIMEFRAMES, BACKFILL_MIN_CANDLES } from "../../src/config/env";
import { setBackfillTarget, incrementBackfillProgress, getBackfillSnapshot } from "../state/systemHealth";

const SUPPORTED_TIMEFRAMES: readonly FuturesTimeframe[] = [
  "1m",
  "3m",
  "5m",
  "15m",
  "1h",
  "4h",
  "1d",
  "1w",
  "1M",
] as const;

const TIMEFRAMES: FuturesTimeframe[] = (() => {
  const allowed = new Set<string>(SUPPORTED_TIMEFRAMES);
  const envFrames = BACKFILL_TIMEFRAMES.filter((frame): frame is FuturesTimeframe => allowed.has(frame));
  return envFrames.length > 0 ? envFrames : [...SUPPORTED_TIMEFRAMES];
})();

const MIN_CANDLES = Math.max(1, BACKFILL_MIN_CANDLES);
const BATCH_LIMIT = 500;
const RATE_LIMIT_WARN_THRESHOLD = 1000;

const timeframeToMs: Record<FuturesTimeframe, number> = {
  "1m": 60 * 1000,
  "3m": 3 * 60 * 1000,
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000,
  "1M": 30 * 24 * 60 * 60 * 1000,
};

function mapToMarketData(symbol: string, timeframe: FuturesTimeframe, kline: BinanceKline): MarketDataUpsert {
  return {
    symbol,
    timeframe,
    ts: new Date(kline.openTime),
    open: kline.open,
    high: kline.high,
    low: kline.low,
    close: kline.close,
    volume: kline.volume,
  };
}

async function collectClosedKlines(
  client: BinanceFuturesClient,
  symbol: string,
  timeframe: FuturesTimeframe,
  requiredCandles: number,
): Promise<BinanceKline[]> {
  const required = Math.max(1, requiredCandles);
  const frameMs = timeframeToMs[timeframe];
  const now = Date.now();
  const closedCutoff = now - frameMs;

  const klines: BinanceKline[] = [];
  const seen = new Set<number>();
  let endTime = closedCutoff;

  while (klines.length < required && endTime > 0) {
    const startTime = Math.max(0, endTime - frameMs * BATCH_LIMIT);

    const { klines: batch, usedWeight } = await client.fetchKlines({
      symbol,
      interval: timeframe,
      startTime,
      endTime,
      limit: BATCH_LIMIT,
    });

    if (typeof usedWeight === "number" && usedWeight > RATE_LIMIT_WARN_THRESHOLD) {
      console.warn(
        `[backfill] High Binance weight usage ${usedWeight} for ${symbol} ${timeframe} within 1m window`,
      );
    }

    const filtered = batch.filter((item) => item.closeTime <= closedCutoff);

    if (filtered.length === 0) {
      break;
    }

    for (const item of filtered) {
      if (!seen.has(item.openTime)) {
        seen.add(item.openTime);
        klines.push(item);
      }
    }

    const earliest = filtered[0];
    const nextEnd = earliest.openTime - frameMs;
    if (nextEnd >= endTime) {
      break;
    }
    endTime = nextEnd;
  }

  klines.sort((a, b) => a.openTime - b.openTime);

  if (klines.length > required) {
    return klines.slice(klines.length - required);
  }

  return klines;
}

export async function runFuturesBackfill(): Promise<void> {
  const futuresEnabled = FUTURES;
  if (!futuresEnabled) {
    console.warn("[backfill] FUTURES flag is not true. Skipping futures backfill.");
    return;
  }

  const symbols = CONFIGURED_SYMBOLS;
  if (symbols.length === 0) {
    console.warn("[backfill] SYMBOL_LIST is empty. Skipping backfill.");
    return;
  }

  const client = new BinanceFuturesClient();

  const summary = new Map<
    string,
    {
      downloaded: number;
      upserted: number;
    }
  >();

  for (const timeframe of TIMEFRAMES) {
    setBackfillTarget(timeframe, CONFIGURED_SYMBOLS.length * MIN_CANDLES);
    summary.set(timeframe, { downloaded: 0, upserted: 0 });
  }

  for (const symbol of symbols) {
    for (const timeframe of TIMEFRAMES) {
      try {
        const klines = await collectClosedKlines(client, symbol, timeframe, MIN_CANDLES);

        if (klines.length === 0) {
          console.warn(`[backfill] No klines returned for ${symbol} ${timeframe}.`);
          continue;
        }

        const marketRows = klines.map((kline) => mapToMarketData(symbol, timeframe, kline));
        const affected = await bulkUpsertMarketData(marketRows);

        incrementBackfillProgress(timeframe, klines.length);
        const entry = summary.get(timeframe);
        if (entry) {
          entry.downloaded += klines.length;
          entry.upserted += affected;
        }

        console.info(
          `[backfill] ${symbol} ${timeframe} -> downloaded=${klines.length} upserted=${affected}`,
        );
      } catch (error) {
        console.warn(
          `[backfill] Failed to backfill ${symbol} ${timeframe}: ${(error as Error).message ?? error}`,
        );
      }
    }
  }

  const snapshot = getBackfillSnapshot();
  for (const timeframe of TIMEFRAMES) {
    const entry = summary.get(timeframe) ?? { downloaded: 0, upserted: 0 };
    const progress = snapshot[timeframe] ?? { done: entry.downloaded, target: symbols.length * MIN_CANDLES };
    console.info(
      `[backfill] summary ${timeframe}: downloaded=${entry.downloaded} upserted=${entry.upserted} progress=${progress.done}/${progress.target}`,
    );
  }
}

export const BackfillTimeframes = TIMEFRAMES;
