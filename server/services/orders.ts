// server/services/orders.ts
// Adapter: if project already has an order engine, delegate to it.
// Otherwise, persist a "submitted" record into positions so the automation picks it up.

import { sql } from "drizzle-orm";
import { db } from "../db"; // adjust to your drizzle db export if different

type PlaceArgs = {
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT";
  quantity: number;
  price?: number;
  requestId: string;
  source?: string | null;
};

export async function placeOrder(args: PlaceArgs): Promise<{ id: string; status: string }> {
  // Try existing engine if present
  try {
    // If there is an existing engine module, prefer it:
    // const engine = await import("../engine/orderEngine"); // adjust if exists
    // return await engine.placeOrder(args);
  } catch {
    // ignore, fallback below
  }

  // Fallback: insert into positions as "submitted" (idempotent on requestId)
  await db.execute(sql`
    INSERT INTO public."positions" (request_id, symbol, side, order_type, quantity, price, status, source)
    VALUES (${args.requestId}, ${args.symbol}, ${args.side}, ${args.type}, ${args.quantity}, ${args.price ?? null}, 'submitted', ${args.source ?? 'quick-trade'})
    ON CONFLICT ON CONSTRAINT positions_request_id_uniq
    DO UPDATE SET
      symbol = EXCLUDED.symbol,
      side = EXCLUDED.side,
      order_type = EXCLUDED.order_type,
      quantity = EXCLUDED.quantity,
      price = EXCLUDED.price,
      status = 'submitted',
      source = COALESCE(EXCLUDED.source, public."positions".source);
  `);

  return { id: args.requestId, status: "submitted" };
}
