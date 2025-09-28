// shared/types/trade.ts
export type Side = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT";
export type InputMode = "USDT" | "QTY";

export interface QuickTradeRequest {
  symbol: string;
  side: Side;
  quantity: number;            // normalized base qty sent to backend
  type: OrderType;
  price?: number | null;       // LIMIT required; MARKET optional if lastPrice present
  // --- optional, for convenience/telemetry ---
  mode?: InputMode;            // which input the user edited
  quoteAmount?: number | null; // USDT (quote) entered by user
  lastPrice?: number | null;   // front-end known price for MARKET calc
}

export interface QuickTradeResponse {
  ok: boolean;
  message: string;
  requestId: string;
  orderId?: string | null;
  status?: string | null;
  ts: string;
  // echo back computed values for UI confirmation
  symbol?: string;
  quantity?: number | null;
  price?: number | null;
  quoteAmount?: number | null;
}
