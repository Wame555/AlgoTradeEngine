// client/src/lib/quickTradeCalc.ts
import type { InputMode, OrderType, QuickTradeRequest, Side } from "@shared/types/trade";

export interface BuildArgs {
  symbol: string;
  side: Side;
  type: OrderType;
  mode: InputMode;                 // "USDT" | "QTY"
  quantityInput?: number | null;   // base qty typed by user
  usdtInput?: number | null;       // quote amount typed by user
  price?: number | null;           // explicit price (LIMIT) or override (MARKET)
  lastPrice?: number | null;       // live price from ticker/WS for MARKET
}

function toNum(n: unknown): number | null {
  if (typeof n === "number" && Number.isFinite(n)) return n;
  if (typeof n === "string") {
    const v = Number(n);
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

function roundToStep(v: number, step = 1e-8): number {
  const inv = 1 / step;
  return Math.floor(v * inv + 1e-9) / inv;
}

export function buildQuickTradePayload(a: BuildArgs): QuickTradeRequest {
  const symbol = a.symbol?.trim() || "BTCUSDT";
  const side = a.side;
  const type = a.type;

  const price = toNum(a.price);
  const lastPrice = toNum(a.lastPrice);
  const qtyIn = toNum(a.quantityInput);
  const usdtIn = toNum(a.usdtInput);

  let usedPrice: number | null = null;
  if (type === "LIMIT") usedPrice = price ?? null;
  else usedPrice = price ?? lastPrice ?? null;

  let qty = qtyIn && qtyIn > 0 ? qtyIn : null;
  if ((!qty || qty <= 0) && a.mode === "USDT" && usdtIn && usdtIn > 0 && usedPrice && usedPrice > 0) {
    qty = roundToStep(usdtIn / usedPrice, 1e-8);
  }

  // fallback to zero; backend validates strictly
  return {
    symbol,
    side,
    type,
    quantity: qty ?? 0,
    price: type === "LIMIT" ? usedPrice : usedPrice ?? null, // MARKET can omit; we still pass if known
    mode: a.mode,
    quoteAmount: usdtIn ?? null,
    lastPrice: type === "MARKET" ? usedPrice ?? null : usedPrice,
  };
}
