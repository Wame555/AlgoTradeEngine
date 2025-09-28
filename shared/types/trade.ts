// shared/types/trade.ts
export type Side = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT";

export interface QuickTradeRequest {
  symbol: string;          // pl. "BTCUSDT"
  side: Side;              // "BUY" | "SELL"
  quantity: number;        // mennyiség (pl. darab)
  price?: number | null;   // LIMIT-hez opcionális
  type: OrderType;         // "MARKET" | "LIMIT"
}

export interface QuickTradeResponse {
  ok: boolean;
  message: string;
  requestId: string;       // backend által generált
  orderId?: string | null; // ha tényleges rendelés jönne létre
  status?: string | null;  // pl. "accepted" | "queued" | "executed"
  ts: string;              // ISO timestamp
}
