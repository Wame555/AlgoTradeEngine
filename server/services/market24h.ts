import Decimal from "decimal.js";
import { sql } from "drizzle-orm";

import { db } from "../db";

export type Market24hItem = { symbol: string; last: number | null; prevClose: number | null; changePct: number | null };
export type SymbolStatus = { symbol: string; active: boolean };

async function resolveActiveSymbols(): Promise<string[]> {
  const pairs = await db.execute<{ symbol: string }>(sql`
    WITH src AS (
      SELECT symbol FROM public."trading_pairs" WHERE is_active = true
      UNION
      SELECT DISTINCT symbol FROM public."market_data"
    )
    SELECT symbol FROM src GROUP BY symbol ORDER BY symbol LIMIT 200;
  `);
  return pairs.rows.map((row) => row.symbol);
}

export async function get24hChangeForSymbols(symbols?: string[]): Promise<Market24hItem[]> {
  const syms = symbols && symbols.length > 0 ? symbols : await resolveActiveSymbols();
  const items: Market24hItem[] = [];

  for (const symbol of syms) {
    const lastRow = await db.execute<{ price: number | null }>(sql`
      SELECT close AS price FROM public."market_data"
      WHERE symbol = ${symbol}
      ORDER BY ts DESC
      LIMIT 1;
    `);

    const prevRow = await db.execute<{ price: number | null }>(sql`
      SELECT close AS price FROM public."market_data"
      WHERE symbol = ${symbol} AND ts < (NOW() AT TIME ZONE 'UTC' - INTERVAL '24 hours')
      ORDER BY ts DESC
      LIMIT 1;
    `);

    const last = lastRow.rows[0]?.price ?? null;
    const prev = prevRow.rows[0]?.price ?? null;

    if (last == null || prev == null || !Number.isFinite(last) || !Number.isFinite(prev) || prev === 0) {
      items.push({ symbol, last: last ?? null, prevClose: prev ?? null, changePct: null });
      continue;
    }

    const pct = new Decimal(last).minus(prev).div(prev).mul(100).toDecimalPlaces(2).toNumber();
    items.push({ symbol, last, prevClose: prev, changePct: pct });
  }

  return items;
}

export async function resolveSymbolsForMarketChange(qs?: string): Promise<string[]> {
  if (!qs) {
    return [];
  }
  return qs
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter((value) => value.length > 0);
}

export async function listSymbolsWithStatus(): Promise<SymbolStatus[]> {
  const tradingPairs = await db.execute<{ symbol: string; is_active: boolean | null }>(sql`
    SELECT symbol, is_active
    FROM public."trading_pairs"
    ORDER BY symbol
    LIMIT 200;
  `);

  if (tradingPairs.rows.length > 0) {
    return tradingPairs.rows.map((row) => ({ symbol: row.symbol, active: row.is_active ?? true }));
  }

  const fallback = await db.execute<{ symbol: string }>(sql`
    SELECT DISTINCT symbol FROM public."market_data"
    ORDER BY symbol
    LIMIT 200;
  `);

  return fallback.rows.map((row) => ({ symbol: row.symbol, active: true }));
}
