import { pool } from '../db';
import { aggregateYearly } from './metrics';
import { primePrevCloseCaches, setLastPrice } from '../state/marketCache';

function normalizeSymbol(symbol: string): string {
  return symbol.toUpperCase();
}

async function primeLastPriceCache(symbols: string[]): Promise<number> {
  if (symbols.length === 0) {
    return 0;
  }

  try {
    const query = `
      SELECT DISTINCT ON ("symbol") "symbol", "close"
      FROM public."market_data"
      WHERE "symbol" = ANY($1::text[])
      ORDER BY "symbol", "ts" DESC;
    `;

    const result = await pool.query(query, [symbols]);
    let primed = 0;

    for (const row of result.rows ?? []) {
      const rawSymbol = String(row.symbol ?? '').trim();
      const symbol = normalizeSymbol(rawSymbol);
      const close = Number(row.close ?? 0);

      if (!symbol) {
        continue;
      }

      if (Number.isFinite(close) && close > 0) {
        setLastPrice(symbol, close);
        primed += 1;
      }
    }

    return primed;
  } catch (error) {
    console.warn(
      `[bootstrap] failed to prime last price cache: ${(error as Error).message ?? error}`,
    );
    return 0;
  }
}

export interface CacheBootstrapResult {
  prevClosePrimed: Record<string, number>;
  lastPricePrimed: number;
  yearlyAggregates: number;
  ready: boolean;
}

export async function bootstrapMarketCaches(
  symbols: string[],
  timeframes: string[],
): Promise<CacheBootstrapResult> {
  const uniqueSymbols = Array.from(new Set(symbols.map(normalizeSymbol)));

  const prevClosePrimed = await primePrevCloseCaches(uniqueSymbols, timeframes);
  const lastPricePrimed = await primeLastPriceCache(uniqueSymbols);

  let yearlyAggregates = 0;
  const currentYear = new Date().getUTCFullYear();

  for (const symbol of uniqueSymbols) {
    try {
      const candle = await aggregateYearly(symbol, currentYear - 1);
      if (candle) {
        yearlyAggregates += 1;
      }
    } catch (error) {
      console.warn(
        `[bootstrap] failed to aggregate yearly candle for ${symbol}: ${(error as Error).message ?? error}`,
      );
    }
  }

  const hasPrevClose = Object.values(prevClosePrimed).some((count) => count > 0);
  const ready = uniqueSymbols.length === 0 || hasPrevClose || lastPricePrimed > 0;

  return { prevClosePrimed, lastPricePrimed, yearlyAggregates, ready };
}
