// shared/types/trade.ts
export type Side = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT";
export type InputMode = "USDT" | "QTY";

export interface QuickTradeRequest {
  symbol: string;
  side: Side;
  type: OrderType;
  quantity: number;            // base qty (derived if USDT mode)
  price?: number | null;       // LIMIT required; MARKET optional
  mode?: InputMode;
  quoteAmount?: number | null; // USDT entered
  lastPrice?: number | null;   // front-known price for MARKET
  requestId?: string | null;   // optional client-provided id
  source?: string | null;      // "quick-trade"
}

export interface QuickTradeResponse {
  ok: boolean;
  message: string;
  requestId: string;
  orderId?: string | null;
  status?: string | null;
  ts: string;
  symbol?: string;
  quantity?: number | null;
  price?: number | null;
  quoteAmount?: number | null;
}
