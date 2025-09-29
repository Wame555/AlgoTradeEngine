import type { InputMode, OrderType, QuickTradeRequest, Side } from "@shared/types/trade";

export interface BuildArgs {
  symbol: string | null | undefined;
  side: Side;
  type: OrderType;
  mode: InputMode;
  qtyInput?: string | number | null;
  usdtInput?: string | number | null;
  price?: string | number | null;
  lastPrice?: string | number | null;
  qtyStep?: number | null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  let normalized = value.trim();
  if (!normalized) {
    return null;
  }

  normalized = normalized.replace(/\u00A0/g, " ").replace(/\s+/g, "");

  if (normalized.includes(",") && normalized.includes(".")) {
    normalized = normalized.replace(/,/g, "");
  } else if (normalized.includes(",") && !normalized.includes(".")) {
    normalized = normalized.replace(/,/g, ".");
  }

  if (!/^[+-]?\d*(?:\.\d+)?$/.test(normalized)) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundToStep(value: number, step: number | null | undefined): number {
  if (!Number.isFinite(value)) {
    return value;
  }

  const resolvedStep = typeof step === "number" && step > 0 ? step : 1e-8;
  const inverse = 1 / resolvedStep;
  return Math.floor(value * inverse + 1e-9) / inverse;
}

export function buildQuickTrade(args: BuildArgs): QuickTradeRequest {
  const symbol = (args.symbol ?? "").toString().trim().toUpperCase() || "BTCUSDT";
  const side = args.side;
  const type = args.type;
  const mode = args.mode;

  const price = toNumber(args.price);
  const lastPrice = toNumber(args.lastPrice);
  const qtyInput = toNumber(args.qtyInput);
  const usdtInput = toNumber(args.usdtInput);

  let effectivePrice: number | null = null;
  if (type === "LIMIT") {
    effectivePrice = price ?? null;
  } else {
    effectivePrice = price ?? lastPrice ?? null;
  }

  let quantity = qtyInput && qtyInput > 0 ? qtyInput : null;
  if ((!quantity || quantity <= 0) && mode === "USDT" && usdtInput && usdtInput > 0 && effectivePrice && effectivePrice > 0) {
    quantity = roundToStep(usdtInput / effectivePrice, args.qtyStep);
  }

  const resolvedQuantity = quantity ?? 0;
  const resolvedQuote = usdtInput ?? null;
  const resolvedPrice = type === "LIMIT" ? effectivePrice : effectivePrice ?? null;
  const resolvedLastPrice = type === "MARKET" ? effectivePrice ?? null : effectivePrice;

  return {
    symbol,
    side,
    type,
    quantity: resolvedQuantity,
    price: resolvedPrice,
    mode,
    quoteAmount: resolvedQuote,
    lastPrice: resolvedLastPrice,
    source: "quick-trade",
  };
}
