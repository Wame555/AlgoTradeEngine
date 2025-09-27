import Decimal from "decimal.js";

import { pool } from "../db";

type RawRow = {
  symbol: string;
  close: unknown;
  ts: Date | string;
};

export interface Market24hChangeItem {
  symbol: string;
  last: number | null;
  prevClose: number | null;
  changePct: number | null;
}

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function toDecimal(value: unknown): Decimal | null {
  try {
    const decimal = new Decimal(value ?? 0);
    if (!decimal.isFinite()) {
      return null;
    }
    return decimal;
  } catch {
    return null;
  }
}

function toNumberOrNull(decimal: Decimal | null): number | null {
  if (!decimal || !decimal.isFinite()) {
    return null;
  }
  return decimal.toNumber();
}

function parseRows(rows: RawRow[]): Map<string, { close: Decimal; ts: Date }[]> {
  const map = new Map<string, { close: Decimal; ts: Date }[]>();
  for (const row of rows) {
    const closeDecimal = toDecimal(row.close);
    if (!closeDecimal) {
      continue;
    }
    const ts = row.ts instanceof Date ? row.ts : new Date(row.ts);
    const symbol = normalizeSymbol(row.symbol);
    const list = map.get(symbol) ?? [];
    list.push({ close: closeDecimal, ts });
    map.set(symbol, list);
  }
  return map;
}

export async function get24hChangeForSymbols(symbols: string[]): Promise<Market24hChangeItem[]> {
  if (symbols.length === 0) {
    return [];
  }

  const uniqueSymbols = Array.from(new Set(symbols.map((symbol) => normalizeSymbol(symbol))));
  const now = new Date();
  const startOfUtcDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [lastRowsResult, dailyRowsResult, fallbackRowsResult] = await Promise.all([
    pool.query<RawRow>(
      `
        SELECT DISTINCT ON (symbol) symbol, close, ts
        FROM public.market_data
        WHERE symbol = ANY($1)
        ORDER BY symbol, ts DESC
      `,
      [uniqueSymbols],
    ),
    pool.query<RawRow>(
      `
        SELECT symbol, close, ts
        FROM public.market_data
        WHERE symbol = ANY($1) AND timeframe = '1d'
        ORDER BY symbol, ts DESC
      `,
      [uniqueSymbols],
    ),
    pool.query<RawRow>(
      `
        SELECT DISTINCT ON (symbol) symbol, close, ts
        FROM public.market_data
        WHERE symbol = ANY($1) AND ts <= $2
        ORDER BY symbol, ts DESC
      `,
      [uniqueSymbols, cutoff.toISOString()],
    ),
  ]);

  const lastMap = parseRows(lastRowsResult.rows);
  const dailyMap = parseRows(dailyRowsResult.rows);
  const fallbackMap = parseRows(fallbackRowsResult.rows);

  const items: Market24hChangeItem[] = [];

  for (const symbol of uniqueSymbols) {
    const lastEntry = lastMap.get(symbol)?.[0] ?? null;
    const dailyEntries = dailyMap.get(symbol) ?? [];
    const fallbackEntries = fallbackMap.get(symbol) ?? [];

    let prevCloseDecimal: Decimal | null = null;

    for (const entry of dailyEntries) {
      if (entry.ts < startOfUtcDay) {
        prevCloseDecimal = entry.close;
        break;
      }
    }

    if (!prevCloseDecimal && fallbackEntries.length > 0) {
      const entry = fallbackEntries[0];
      if (entry.ts <= cutoff) {
        prevCloseDecimal = entry.close;
      }
    }

    const lastDecimal = lastEntry ? lastEntry.close : null;

    let changePct: number | null = null;
    if (lastDecimal && prevCloseDecimal && prevCloseDecimal.gt(0)) {
      const changeDecimal = lastDecimal.minus(prevCloseDecimal).div(prevCloseDecimal).times(100);
      changePct = changeDecimal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
    }

    items.push({
      symbol,
      last: toNumberOrNull(lastDecimal),
      prevClose: toNumberOrNull(prevCloseDecimal),
      changePct,
    });
  }

  return items;
}
