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

export interface SymbolStatus {
  symbol: string;
  active: boolean;
}

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeSymbols(values: Iterable<string>): string[] {
  const result = new Set<string>();
  for (const value of values) {
    const normalized = normalizeSymbol(value);
    if (normalized.length > 0) {
      result.add(normalized);
    }
  }
  return Array.from(result);
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

async function tableExists(tableName: string): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = $1
      ) AS exists;
    `,
    [tableName],
  );
  return Boolean(result.rows[0]?.exists);
}

async function getColumnNames(tableName: string): Promise<Set<string>> {
  const result = await pool.query<{ column_name: string }>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1;
    `,
    [tableName],
  );
  const columns = new Set<string>();
  for (const row of result.rows) {
    if (row?.column_name) {
      columns.add(row.column_name.toLowerCase());
    }
  }
  return columns;
}

async function fetchSymbolsFromTable(tableName: string): Promise<SymbolStatus[]> {
  if (!(await tableExists(tableName))) {
    return [];
  }

  const columns = await getColumnNames(tableName);
  const selectColumns = ['symbol'];
  if (columns.has('is_active')) {
    selectColumns.push('is_active');
  }
  if (columns.has('active')) {
    selectColumns.push('active');
  }

  const query = `SELECT ${selectColumns.map((column) => `"${column}"`).join(', ')} FROM public."${tableName}"`;
  try {
    const result = await pool.query<Record<string, unknown>>(query);
    const map = new Map<string, SymbolStatus>();
    for (const row of result.rows) {
      const rawSymbol = typeof row.symbol === 'string' ? row.symbol : null;
      if (!rawSymbol) {
        continue;
      }
      const symbol = normalizeSymbol(rawSymbol);
      if (!symbol) {
        continue;
      }
      let active = true;
      if (columns.has('is_active') && typeof row.is_active === 'boolean') {
        active = row.is_active;
      } else if (columns.has('active') && typeof row.active === 'boolean') {
        active = row.active;
      }
      const existing = map.get(symbol);
      if (existing) {
        map.set(symbol, { symbol, active: existing.active || active });
      } else {
        map.set(symbol, { symbol, active });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
  } catch {
    return [];
  }
}

async function fetchDistinctSymbolsFromMarketData(limit: number = 100): Promise<SymbolStatus[]> {
  if (!(await tableExists('market_data'))) {
    return [];
  }

  try {
    const result = await pool.query<{ symbol: string | null }>(
      `
        SELECT symbol
        FROM public."market_data"
        GROUP BY symbol
        ORDER BY symbol
        LIMIT $1
      `,
      [limit],
    );
    const map = new Map<string, SymbolStatus>();
    for (const row of result.rows) {
      const rawSymbol = row.symbol ?? '';
      const symbol = normalizeSymbol(rawSymbol);
      if (!symbol) {
        continue;
      }
      if (!map.has(symbol)) {
        map.set(symbol, { symbol, active: true });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
  } catch {
    return [];
  }
}

async function getSymbolsFromDatabase(): Promise<SymbolStatus[]> {
  const candidates = ['trading_pairs', 'pairs', 'symbols'] as const;
  for (const tableName of candidates) {
    const symbols = await fetchSymbolsFromTable(tableName);
    if (symbols.length > 0) {
      return symbols;
    }
  }
  return [];
}

export async function listSymbolsWithStatus(): Promise<SymbolStatus[]> {
  const fromDb = await getSymbolsFromDatabase();
  if (fromDb.length > 0) {
    return fromDb;
  }
  return fetchDistinctSymbolsFromMarketData();
}

export async function resolveSymbolsForMarketChange(requestedSymbols: string[] = []): Promise<string[]> {
  const requested = normalizeSymbols(requestedSymbols);
  if (requested.length > 0) {
    return requested;
  }

  const fromDb = await getSymbolsFromDatabase();
  const active = fromDb.filter((item) => item.active).map((item) => item.symbol);
  if (active.length > 0) {
    return active;
  }

  const fallback = await fetchDistinctSymbolsFromMarketData();
  return fallback.map((item) => item.symbol);
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
