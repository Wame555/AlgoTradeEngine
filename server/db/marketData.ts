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

const INSERT_COLUMNS = ["symbol", "timeframe", "ts", "open", "high", "low", "close", "volume"] as const;

const UPSERT_CONSTRAINT = "market_data_symbol_timeframe_ts_uniq";

const BATCH_SIZE = 500;

export async function bulkUpsertMarketData(rows: MarketDataUpsert[]): Promise<number> {
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
