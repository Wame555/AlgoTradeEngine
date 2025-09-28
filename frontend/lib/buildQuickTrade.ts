import { toNumLocale, roundToStep } from "./number";
import type { InputMode, OrderType, QuickTradeRequest, Side } from "../../shared/types/trade";

export interface BuildArgs {
  symbol: string | null | undefined;
  side: Side;
  type: OrderType;
  mode: InputMode;                 // "USDT" | "QTY"
  qtyInput?: string | number | null;
  usdtInput?: string | number | null;
  price?: string | number | null;
  lastPrice?: string | number | null;
  qtyStep?: number;
}

export function buildQuickTrade(a: BuildArgs): QuickTradeRequest {
  const symbol = (a.symbol ?? "").toString().trim() || "BTCUSDT";
  const step = a.qtyStep && a.qtyStep > 0 ? a.qtyStep : 1e-8;

  const side = a.side;
  const type = a.type;
  const price = toNumLocale(a.price);
  const lastPrice = toNumLocale(a.lastPrice);
  const qtyIn = toNumLocale(a.qtyInput);
  const usdtIn = toNumLocale(a.usdtInput);

  let usedPrice: number | null = null;
  if (type === "LIMIT") usedPrice = price ?? null;
  else usedPrice = price ?? lastPrice ?? null;

  let qty = qtyIn && qtyIn > 0 ? qtyIn : null;
  if ((!qty || qty <= 0) && a.mode === "USDT" && usdtIn && usdtIn > 0 && usedPrice && usedPrice > 0) {
    qty = roundToStep(usdtIn / usedPrice, step);
  }

  return {
    symbol,
    side,
    type,
    quantity: qty ?? 0,
    price: type === "LIMIT" ? usedPrice : usedPrice ?? null,
    mode: a.mode,
    quoteAmount: usdtIn ?? null,
    lastPrice: type === "MARKET" ? (usedPrice ?? null) : usedPrice,
    source: "quick-trade",
  };
}
