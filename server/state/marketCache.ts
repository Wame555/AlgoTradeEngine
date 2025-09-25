import { getLastClosedCandle, getLastClosedCandlesForTimeframe } from "../db/marketData";

const lastPrice = new Map<string, number>();
const prevClose = new Map<string, Map<string, number>>();

function normalizeSymbol(symbol: string): string {
  return symbol.toUpperCase();
}

function ensurePrevCloseBucket(symbol: string): Map<string, number> {
  const key = normalizeSymbol(symbol);
  let bucket = prevClose.get(key);
  if (!bucket) {
    bucket = new Map<string, number>();
    prevClose.set(key, bucket);
  }
  return bucket;
}

export function setLastPrice(symbol: string, price: number): void {
  const key = normalizeSymbol(symbol);
  if (Number.isFinite(price)) {
    lastPrice.set(key, price);
  }
}

export function getLastPrice(symbol: string): number | undefined {
  return lastPrice.get(normalizeSymbol(symbol));
}

export function setPrevClose(symbol: string, timeframe: string, close: number): void {
  if (!Number.isFinite(close)) {
    return;
  }
  const bucket = ensurePrevCloseBucket(symbol);
  bucket.set(timeframe, close);
}

export async function getPrevClose(symbol: string, timeframe: string): Promise<number> {
  const bucket = ensurePrevCloseBucket(symbol);
  if (bucket.has(timeframe)) {
    const cached = bucket.get(timeframe);
    return typeof cached === "number" ? cached : 0;
  }

  const record = await getLastClosedCandle(normalizeSymbol(symbol), timeframe);
  if (!record) {
    bucket.set(timeframe, 0);
    return 0;
  }

  const close = Number(record.close);
  if (!Number.isFinite(close)) {
    bucket.set(timeframe, 0);
    return 0;
  }

  bucket.set(timeframe, close);
  return close;
}

export async function getChangePct(symbol: string, timeframe: string): Promise<number> {
  const current = getLastPrice(symbol);
  if (typeof current !== "number" || Number.isNaN(current)) {
    return 0;
  }

  const previous = await getPrevClose(symbol, timeframe);
  if (!Number.isFinite(previous) || previous <= 0) {
    return 0;
  }

  return ((current - previous) / previous) * 100;
}

export async function primePrevCloseCaches(
  symbols: string[],
  timeframes: string[],
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const uniqueSymbols = Array.from(new Set(symbols.map(normalizeSymbol)));

  for (const timeframe of timeframes) {
    try {
      const rows = await getLastClosedCandlesForTimeframe(timeframe, uniqueSymbols);
      let primed = 0;

      rows.forEach((record, symbol) => {
        const close = Number(record.close);
        if (!Number.isFinite(close)) {
          return;
        }
        setPrevClose(symbol, timeframe, close);
        primed += 1;
      });

      counts[timeframe] = primed;
    } catch (error) {
      console.warn(
        `[live] failed to prime prevClose cache for ${timeframe}: ${(error as Error).message ?? error}`,
      );
      counts[timeframe] = counts[timeframe] ?? 0;
    }
  }

  return counts;
}

export function clearPrevCloseCache(): void {
  prevClose.clear();
}

export function clearLastPriceCache(): void {
  lastPrice.clear();
}
