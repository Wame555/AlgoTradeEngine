import { pool } from "../db";
import {
  getLastPrice,
  getPrevCloseFromCache,
  setPrevClose,
} from "../state/marketCache";

import type { Position } from "@shared/schema";
import { SUPPORTED_TIMEFRAMES, type SupportedTimeframe } from "@shared/types";

const DEFAULT_TIMEFRAMES = SUPPORTED_TIMEFRAMES;

type Timeframe = SupportedTimeframe;

export interface Candle {
  symbol: string;
  timeframe: Timeframe;
  ts: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const fallbackCounters = new Map<string, { count: number; warned: boolean }>();

function normalizeSymbol(symbol: string): string {
  return symbol.toUpperCase();
}

function buildFallbackKey(symbol: string, timeframe: string): string {
  return `${normalizeSymbol(symbol)}|${timeframe}`;
}

function resetFallbackCounter(symbol: string, timeframe: string): void {
  fallbackCounters.delete(buildFallbackKey(symbol, timeframe));
}

function trackFallback(symbol: string, timeframe: string): void {
  const key = buildFallbackKey(symbol, timeframe);
  const entry = fallbackCounters.get(key) ?? { count: 0, warned: false };
  entry.count += 1;
  if (!entry.warned && entry.count > 10) {
    console.warn(`[metrics] db fallback exceeded 10 for ${symbol} ${timeframe}`);
    entry.warned = true;
  }
  fallbackCounters.set(key, entry);
}

function safeNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function fetchPrevCloseFromDb(symbol: string, timeframe: string): Promise<number> {
  try {
    const query =
      'SELECT "close" FROM public."market_data" WHERE "symbol" = $1 AND "timeframe" = $2 ORDER BY "ts" DESC LIMIT 1;';
    const result = await pool.query(query, [normalizeSymbol(symbol), timeframe]);
    if (result.rowCount && result.rows[0]) {
      const close = safeNumber(result.rows[0]?.close);
      if (close > 0) {
        return close;
      }
    }
  } catch (error) {
    console.warn(
      `[metrics] failed to load prevClose from db for ${symbol} ${timeframe}: ${(error as Error).message ?? error}`,
    );
  }
  return 0;
}

export function initializeMetrics(symbols: string[], timeframes: readonly string[]): void {
  const uniqueSymbols = new Set(symbols.map(normalizeSymbol));
  const uniqueTimeframes = new Set(timeframes);
  console.info(
    `metrics initialised with ${uniqueSymbols.size} symbols × ${uniqueTimeframes.size} timeframes`,
  );
}

export async function aggregateYearly(symbol: string, year: number): Promise<Candle | null> {
  const normalized = normalizeSymbol(symbol);
  const startOfYear = new Date(Date.UTC(year, 0, 1));
  const startOfNextYear = new Date(Date.UTC(year + 1, 0, 1));

  try {
    const monthlyQuery =
      'SELECT "open", "high", "low", "close", "volume" FROM public."market_data" WHERE "symbol" = $1 AND "timeframe" = $2 AND "ts" >= $3 AND "ts" < $4 ORDER BY "ts" ASC;';
    const monthlyResult = await pool.query(monthlyQuery, [
      normalized,
      "1M",
      startOfYear.toISOString(),
      startOfNextYear.toISOString(),
    ]);

    if (!monthlyResult.rowCount || monthlyResult.rows.length === 0) {
      return null;
    }

    const first = monthlyResult.rows[0];
    const last = monthlyResult.rows[monthlyResult.rows.length - 1];

    const open = safeNumber(first?.open);
    const close = safeNumber(last?.close);

    let high = Number.NEGATIVE_INFINITY;
    let low = Number.POSITIVE_INFINITY;
    let volume = 0;

    for (const row of monthlyResult.rows) {
      const rowHigh = safeNumber(row.high);
      const rowLow = safeNumber(row.low);
      const rowVolume = safeNumber(row.volume);

      if (rowHigh > high) {
        high = rowHigh;
      }
      if (rowLow < low) {
        low = rowLow;
      }
      volume += rowVolume;
    }

    if (!Number.isFinite(high)) {
      high = close > open ? close : open;
    }

    if (!Number.isFinite(low)) {
      low = close < open ? close : open;
    }

    if (!Number.isFinite(open) || !Number.isFinite(close) || open <= 0 || close <= 0) {
      return null;
    }

    const candle: Candle = {
      symbol: normalized,
      timeframe: "1y",
      ts: startOfYear,
      open,
      high: Number.isFinite(high) ? high : open,
      low: Number.isFinite(low) ? low : open,
      close,
      volume,
    };

    const upsertQuery = `
      INSERT INTO public."market_data" ("symbol", "timeframe", "ts", "open", "high", "low", "close", "volume")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT ON CONSTRAINT market_data_symbol_timeframe_ts_uniq
      DO UPDATE SET
        "open" = EXCLUDED."open",
        "high" = EXCLUDED."high",
        "low" = EXCLUDED."low",
        "close" = EXCLUDED."close",
        "volume" = EXCLUDED."volume";
    `;

    await pool.query(upsertQuery, [
      candle.symbol,
      candle.timeframe,
      candle.ts.toISOString(),
      candle.open,
      candle.high,
      candle.low,
      candle.close,
      candle.volume,
    ]);

    if (candle.close > 0) {
      setPrevClose(candle.symbol, candle.timeframe, candle.close);
      resetFallbackCounter(candle.symbol, candle.timeframe);
    }

    return candle;
  } catch (error) {
    console.warn(
      `[metrics] failed to aggregate yearly candle for ${symbol} ${year}: ${(error as Error).message ?? error}`,
    );
    return null;
  }
}

export async function getPrevClose(symbol: string, timeframe: string): Promise<number> {
  const normalized = normalizeSymbol(symbol);
  const cached = getPrevCloseFromCache(normalized, timeframe);
  if (typeof cached === "number") {
    return cached;
  }

  trackFallback(normalized, timeframe);
  let close = await fetchPrevCloseFromDb(normalized, timeframe);

  if (close > 0) {
    setPrevClose(normalized, timeframe, close);
    resetFallbackCounter(normalized, timeframe);
    return close;
  }

  if (timeframe === "1y") {
    const previousYear = new Date().getUTCFullYear() - 1;
    const yearlyCandle = await aggregateYearly(normalized, previousYear);
    if (yearlyCandle && yearlyCandle.close > 0) {
      close = yearlyCandle.close;
      setPrevClose(normalized, timeframe, close);
      resetFallbackCounter(normalized, timeframe);
      return close;
    }
  }

  setPrevClose(normalized, timeframe, 0);
  return 0;
}

export async function getChangePct(symbol: string, timeframe: string): Promise<number> {
  const prev = await getPrevClose(symbol, timeframe);
  if (!Number.isFinite(prev) || prev <= 0) {
    return 0;
  }

  const lastValue = getLastPrice(symbol);
  if (typeof lastValue !== "number" || !Number.isFinite(lastValue)) {
    return 0;
  }

  const last = lastValue;
  return ((last - prev) / prev) * 100;
}

export async function getPnlForPosition(position: Position, timeframe: string): Promise<number> {
  const prev = await getPrevClose(position.symbol, timeframe);
  if (!Number.isFinite(prev) || prev <= 0) {
    return 0;
  }

  const lastValue = getLastPrice(position.symbol);
  if (typeof lastValue !== "number" || !Number.isFinite(lastValue)) {
    return 0;
  }

  const last = lastValue;
  const qty = safeNumber(position.size);
  if (!Number.isFinite(qty) || qty <= 0) {
    return 0;
  }

  const side = String(position.side ?? "").toUpperCase();
  if (side !== "LONG" && side !== "SHORT") {
    return 0;
  }

  if (side === "LONG") {
    return (last - prev) * qty;
  }

  return (prev - last) * qty;
}

export async function getPnlByTimeframes(
  position: Position,
  timeframes: readonly string[] = DEFAULT_TIMEFRAMES,
): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  const frames = timeframes.length > 0 ? timeframes : DEFAULT_TIMEFRAMES;

  for (const frame of frames) {
    try {
      result[frame] = await getPnlForPosition(position, frame);
    } catch {
      result[frame] = 0;
    }
  }

  return result;
}

export { DEFAULT_TIMEFRAMES };
