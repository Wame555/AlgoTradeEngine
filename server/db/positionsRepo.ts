import { pool } from "../db";

import type { InsertPosition } from "@shared/schema";

const TABLE = 'public."positions"';

const SELECT_COLUMNS = `
  "id",
  "user_id",
  "symbol",
  "side",
  "size",
  COALESCE(
    "qty",
    CASE
      WHEN "size" IS NOT NULL AND "entry_price" IS NOT NULL AND "entry_price" <> 0
        THEN ROUND("size" / NULLIF("entry_price", 0), 8)
      ELSE NULL
    END
  ) AS qty,
  "entry_price",
  "current_price",
  "pnl",
  "stop_loss",
  "take_profit",
  COALESCE("tp_price", "take_profit") AS tp_price,
  COALESCE("sl_price", "stop_loss") AS sl_price,
  "leverage",
  COALESCE("amount_usd", "size") AS amount_usd,
  "trailing_stop_percent",
  "status",
  "order_id",
  "request_id",
  "opened_at",
  "updated_at",
  "closed_at"
`;

const SELECT_COLUMNS_ALIAS = `
  p."id",
  p."user_id",
  p."symbol",
  p."side",
  p."size",
  COALESCE(
    p."qty",
    CASE
      WHEN p."size" IS NOT NULL AND p."entry_price" IS NOT NULL AND p."entry_price" <> 0
        THEN ROUND(p."size" / NULLIF(p."entry_price", 0), 8)
      ELSE NULL
    END
  ) AS qty,
  p."entry_price",
  p."current_price",
  p."pnl",
  p."stop_loss",
  p."take_profit",
  COALESCE(p."tp_price", p."take_profit") AS tp_price,
  COALESCE(p."sl_price", p."stop_loss") AS sl_price,
  p."leverage",
  COALESCE(p."amount_usd", p."size") AS amount_usd,
  p."trailing_stop_percent",
  p."status",
  p."order_id",
  p."request_id",
  p."opened_at",
  p."updated_at",
  p."closed_at"
`;

const COLUMN_MAP: Record<string, string> = {
  id: "id",
  userId: "user_id",
  symbol: "symbol",
  side: "side",
  size: "size",
  qty: "qty",
  amountUsd: "amount_usd",
  leverage: "leverage",
  entryPrice: "entry_price",
  currentPrice: "current_price",
  pnl: "pnl",
  stopLoss: "stop_loss",
  takeProfit: "take_profit",
  tpPrice: "tp_price",
  slPrice: "sl_price",
  trailingStopPercent: "trailing_stop_percent",
  status: "status",
  orderId: "order_id",
  requestId: "request_id",
  openedAt: "opened_at",
  updatedAt: "updated_at",
  closedAt: "closed_at",
};

type PositionRow = Record<string, any>;

type InsertPositionInput = InsertPosition & { id: string; updatedAt?: Date | null };

type ColumnKey = keyof typeof COLUMN_MAP;

export type UpdatePositionInput = Partial<Record<ColumnKey, unknown>> & {
  updatedAt?: Date | null;
};

async function query<T = PositionRow>(sql: string, params: any[] = []): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

function normaliseSize(data: { size?: unknown; amountUsd?: unknown; qty?: unknown }): unknown {
  if (data.size != null && data.size !== undefined) {
    return data.size;
  }
  if (data.amountUsd != null && data.amountUsd !== undefined) {
    return data.amountUsd;
  }
  return data.qty;
}

function mapDataToColumns(
  data: Record<string, unknown>,
  { includeNulls = true }: { includeNulls?: boolean } = {},
): Array<[string, unknown]> {
  const entries: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(data)) {
    if (!COLUMN_MAP[key]) {
      continue;
    }
    if (value === undefined) {
      continue;
    }
    if (!includeNulls && value === null) {
      continue;
    }
    const column = COLUMN_MAP[key];
    if (column === "size") {
      const existingIndex = entries.findIndex(([col]) => col === "size");
      if (existingIndex !== -1) {
        entries.splice(existingIndex, 1);
      }
    }
    entries.push([column, value]);
  }
  return entries;
}

export async function selectDedupedOpenPositions(userId: string): Promise<PositionRow[]> {
  const sql = `
    WITH deduped AS (
      SELECT DISTINCT ON (p."symbol", p."side", p."entry_price", p."opened_at")
        ${SELECT_COLUMNS_ALIAS}
      FROM ${TABLE} p
      WHERE p."user_id" = $1 AND p."status" = 'OPEN'
      ORDER BY p."symbol", p."side", p."entry_price", p."opened_at" DESC
    )
    SELECT ${SELECT_COLUMNS}
    FROM deduped
    ORDER BY "opened_at" DESC;
  `;
  return query(sql, [userId]);
}

export async function selectOpenPositionsByUser(userId: string): Promise<PositionRow[]> {
  const sql = `
    SELECT ${SELECT_COLUMNS}
    FROM ${TABLE}
    WHERE "user_id" = $1 AND "status" = 'OPEN'
    ORDER BY "opened_at" DESC;
  `;
  return query(sql, [userId]);
}

export async function selectAllOpenPositions(): Promise<PositionRow[]> {
  const sql = `
    SELECT ${SELECT_COLUMNS}
    FROM ${TABLE}
    WHERE "status" = 'OPEN'
    ORDER BY "opened_at" DESC;
  `;
  return query(sql);
}

export async function selectPositionById(id: string): Promise<PositionRow | undefined> {
  const sql = `
    SELECT ${SELECT_COLUMNS}
    FROM ${TABLE}
    WHERE "id" = $1
    LIMIT 1;
  `;
  const rows = await query(sql, [id]);
  return rows[0];
}

export async function selectPositionByRequestId(requestId: string): Promise<PositionRow | undefined> {
  const sql = `
    SELECT ${SELECT_COLUMNS}
    FROM ${TABLE}
    WHERE "request_id" = $1
    LIMIT 1;
  `;
  const rows = await query(sql, [requestId]);
  return rows[0];
}

export async function insertPosition(data: InsertPositionInput): Promise<PositionRow> {
  const payload: Record<string, unknown> = { ...data };
  const normalisedSize = normaliseSize(payload);
  if (normalisedSize == null) {
    throw new Error("Position size is required");
  }
  payload.size = normalisedSize;

  if (!payload.updatedAt) {
    payload.updatedAt = new Date();
  }

  const entries = mapDataToColumns(payload);
  if (entries.length === 0) {
    throw new Error("No columns provided for insert");
  }

  const columns = entries.map(([column]) => `"${column}"`).join(", ");
  const placeholders = entries.map((_, index) => `$${index + 1}`).join(", ");
  const values = entries.map(([, value]) => value);

  const sql = `
    INSERT INTO ${TABLE} (${columns})
    VALUES (${placeholders})
    RETURNING ${SELECT_COLUMNS};
  `;

  const rows = await query(sql, values);
  const inserted = rows[0];
  if (!inserted) {
    throw new Error("Failed to insert position");
  }
  return inserted;
}

export async function updatePosition(
  id: string,
  updates: UpdatePositionInput,
): Promise<PositionRow | undefined> {
  const payload: Record<string, unknown> = { ...updates };
  const normalisedSize = normaliseSize(payload);
  if (normalisedSize != null) {
    payload.size = normalisedSize;
  }

  payload.updatedAt = payload.updatedAt ?? new Date();

  const entries = mapDataToColumns(payload);
  if (entries.length === 0) {
    return selectPositionById(id);
  }

  const setClauses = entries.map(([column], index) => `"${column}" = $${index + 1}`).join(", ");
  const values = entries.map(([, value]) => value);
  values.push(id);

  const sql = `
    UPDATE ${TABLE}
    SET ${setClauses}
    WHERE "id" = $${entries.length + 1}
    RETURNING ${SELECT_COLUMNS};
  `;

  const rows = await query(sql, values);
  return rows[0];
}

export async function updatePositionsByIds(
  ids: string[],
  updates: UpdatePositionInput,
): Promise<PositionRow[]> {
  if (ids.length === 0) {
    return [];
  }

  const payload: Record<string, unknown> = { ...updates };
  const normalisedSize = normaliseSize(payload);
  if (normalisedSize != null) {
    payload.size = normalisedSize;
  }

  payload.updatedAt = payload.updatedAt ?? new Date();

  const entries = mapDataToColumns(payload);
  if (entries.length === 0) {
    const placeholders = ids.map((_, index) => `$${index + 1}`).join(", ");
    const sql = `
      SELECT ${SELECT_COLUMNS}
      FROM ${TABLE}
      WHERE "id" IN (${placeholders});
    `;
    return query(sql, ids);
  }

  const setClauses = entries.map(([column], index) => `"${column}" = $${index + 1}`).join(", ");
  const values = entries.map(([, value]) => value);
  const idPlaceholders = ids.map((_, index) => `$${entries.length + index + 1}`).join(", ");

  const sql = `
    UPDATE ${TABLE}
    SET ${setClauses}
    WHERE "id" IN (${idPlaceholders})
    RETURNING ${SELECT_COLUMNS};
  `;

  return query(sql, [...values, ...ids]);
}
