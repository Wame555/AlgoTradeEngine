import { pool } from "../db";

export interface MarketDataUpsert {
  symbol: string;
  timeframe: string;
  ts: Date;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

export interface MarketDataRow {
  symbol: string;
  timeframe: string;
  ts: Date;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

const INSERT_COLUMNS = ["symbol", "timeframe", "ts", "open", "high", "low", "close", "volume"] as const;

const UPSERT_CONSTRAINT = "market_data_symbol_timeframe_ts_uniq";

const BATCH_SIZE = 500;

function mapQueryRow(row: Record<string, unknown>): MarketDataRow {
  return {
    symbol: String(row.symbol ?? ""),
    timeframe: String(row.timeframe ?? ""),
    ts: row.ts instanceof Date ? row.ts : new Date(String(row.ts ?? 0)),
    open: String(row.open ?? "0"),
    high: String(row.high ?? "0"),
    low: String(row.low ?? "0"),
    close: String(row.close ?? "0"),
    volume: String(row.volume ?? "0"),
  };
}

async function performBulkUpsert(rows: MarketDataUpsert[]): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }

  let totalAffected = 0;

  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const chunk = rows.slice(offset, offset + BATCH_SIZE);
    const values: string[] = [];
    const parameters: unknown[] = [];

    chunk.forEach((row, index) => {
      const baseIndex = index * INSERT_COLUMNS.length;
      const placeholders = INSERT_COLUMNS.map((_, columnIdx) => `$${baseIndex + columnIdx + 1}`);
      values.push(`(${placeholders.join(", ")})`);

      parameters.push(
        row.symbol,
        row.timeframe,
        row.ts.toISOString(),
        row.open,
        row.high,
        row.low,
        row.close,
        row.volume,
      );
    });

    const query = `
      INSERT INTO public."market_data" ("symbol", "timeframe", "ts", "open", "high", "low", "close", "volume")
      VALUES ${values.join(",\n")}
      ON CONFLICT ON CONSTRAINT ${UPSERT_CONSTRAINT}
      DO UPDATE SET
        "open" = EXCLUDED."open",
        "high" = EXCLUDED."high",
        "low" = EXCLUDED."low",
        "close" = EXCLUDED."close",
        "volume" = EXCLUDED."volume";
    `;

    const result = await pool.query(query, parameters);
    totalAffected += result.rowCount ?? 0;
  }

  return totalAffected;
}

export async function bulkUpsertCandles(rows: MarketDataUpsert[]): Promise<number> {
  return performBulkUpsert(rows);
}

export async function bulkUpsertMarketData(rows: MarketDataUpsert[]): Promise<number> {
  return performBulkUpsert(rows);
}

export async function getLastClosedCandle(
  symbol: string,
  timeframe: string,
): Promise<MarketDataRow | null> {
  const query = `
    SELECT "symbol", "timeframe", "ts", "open", "high", "low", "close", "volume"
    FROM public."market_data"
    WHERE "symbol" = $1 AND "timeframe" = $2
    ORDER BY "ts" DESC
    LIMIT 1;
  `;

  const result = await pool.query(query, [symbol, timeframe]);
  if (result.rowCount && result.rows[0]) {
    return mapQueryRow(result.rows[0]);
  }

  return null;
}

export async function getLastClosedCandlesForTimeframe(
  timeframe: string,
  symbols: string[],
): Promise<Map<string, MarketDataRow>> {
  const mapped = new Map<string, MarketDataRow>();

  if (symbols.length === 0) {
    return mapped;
  }

  const query = `
    SELECT "symbol", "timeframe", "ts", "open", "high", "low", "close", "volume"
    FROM public."market_data"
    WHERE "timeframe" = $1 AND "symbol" = ANY($2::text[])
    ORDER BY "symbol" ASC, "ts" DESC;
  `;

  const result = await pool.query(query, [timeframe, symbols]);
  const seen = new Set<string>();

  for (const row of result.rows) {
    const record = mapQueryRow(row);
    const symbolKey = record.symbol.toUpperCase();

    if (seen.has(symbolKey)) {
      continue;
    }

    seen.add(symbolKey);
    mapped.set(symbolKey, record);
  }

  return mapped;
}
