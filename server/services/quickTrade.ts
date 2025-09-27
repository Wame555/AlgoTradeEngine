import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";

import { db } from "../db";
import { logError } from "../utils/logger";

import { positions } from "@shared/schema";

export type QuickTradeMode = "QTY" | "USDT";

export interface QuickTradePayload {
  mode?: QuickTradeMode;
  symbol?: string;
  side?: string;
  qty?: string | number | null;
  usdtAmount?: string | number | null;
  tp_price?: string | number | null;
  sl_price?: string | number | null;
  leverage?: string | number | null;
}

export interface QuickTradeParams {
  userId: string;
  payload: QuickTradePayload;
  defaultLeverage?: number | null;
  entryPrice: number;
}

export interface QuickTradeResult {
  id: string;
  orderId: string | null;
}

export class QuickTradeError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = "QuickTradeError";
  }
}

function toDecimal(value: string | number | null | undefined): Decimal | null {
  if (value == null || value === "") {
    return null;
  }
  try {
    const decimal = new Decimal(value as Decimal.Value);
    if (!decimal.isFinite()) {
      return null;
    }
    return decimal;
  } catch {
    return null;
  }
}

function ensurePositiveDecimal(value: Decimal | null): Decimal | null {
  if (!value || !value.isFinite() || value.lte(0)) {
    return null;
  }
  return value;
}

function formatDecimal(value: Decimal, decimals: number): string {
  return value.toDecimalPlaces(decimals, Decimal.ROUND_DOWN).toFixed(decimals);
}

export async function createQuickTradePosition({
  userId,
  payload,
  defaultLeverage,
  entryPrice,
}: QuickTradeParams): Promise<QuickTradeResult> {
  const symbol = payload?.symbol?.toString?.().toUpperCase?.() ?? "";
  if (!symbol) {
    throw new QuickTradeError("BAD_REQUEST", "Symbol is required");
  }

  const rawSide = payload?.side?.toString?.().toUpperCase?.() ?? "";
  const side = rawSide === "SHORT" ? "SHORT" : "LONG";

  const mode: QuickTradeMode = payload?.mode === "USDT" ? "USDT" : "QTY";

  const entryPriceDecimal = ensurePositiveDecimal(toDecimal(entryPrice));
  if (!entryPriceDecimal) {
    throw new QuickTradeError("NO_MARKET_PRICE", "No market price available for the selected symbol");
  }

  const qtyDecimal = ensurePositiveDecimal(toDecimal(payload?.qty)) ?? null;
  const usdtAmountDecimal = ensurePositiveDecimal(toDecimal(payload?.usdtAmount)) ?? null;

  let resolvedQty = qtyDecimal;
  if (mode === "USDT") {
    if (!usdtAmountDecimal) {
      throw new QuickTradeError("BAD_REQUEST", "USDT amount must be greater than zero");
    }
    resolvedQty = ensurePositiveDecimal(usdtAmountDecimal.div(entryPriceDecimal));
  }

  if (!resolvedQty) {
    throw new QuickTradeError("BAD_REQUEST", "Quantity must be greater than zero");
  }

  const amountUsdDecimal = resolvedQty.times(entryPriceDecimal);

  const leverageDecimal = ensurePositiveDecimal(
    toDecimal(payload?.leverage) ?? (defaultLeverage != null ? toDecimal(defaultLeverage) : null),
  ) ?? new Decimal(1);

  const tpDecimal = payload?.tp_price === null ? null : ensurePositiveDecimal(toDecimal(payload?.tp_price));
  const slDecimal = payload?.sl_price === null ? null : ensurePositiveDecimal(toDecimal(payload?.sl_price));

  const qtyStr = formatDecimal(resolvedQty, 8);
  const entryPriceStr = formatDecimal(entryPriceDecimal, 8);
  const amountUsdStr = formatDecimal(amountUsdDecimal, 2);
  const sizeStr = formatDecimal(amountUsdDecimal, 8);
  const leverageStr = formatDecimal(leverageDecimal, 2);
  const tpStr = tpDecimal ? formatDecimal(tpDecimal, 8) : null;
  const slStr = slDecimal ? formatDecimal(slDecimal, 8) : null;

  const orderId = randomUUID();

  try {
    const insertPayload: typeof positions.$inferInsert = {
      userId,
      symbol,
      side,
      qty: qtyStr,
      size: sizeStr,
      entryPrice: entryPriceStr,
      currentPrice: entryPriceStr,
      leverage: leverageStr,
      amountUsd: amountUsdStr,
      status: "OPEN",
      orderId,
    };

    if (tpStr) {
      insertPayload.tpPrice = tpStr;
    }
    if (slStr) {
      insertPayload.slPrice = slStr;
    }

    const [inserted] = await db
      .insert(positions)
      .values(insertPayload)
      .returning({ id: positions.id, orderId: positions.orderId });

    if (!inserted) {
      await logError("quickTrade.insert", new Error("Insert returned no rows"));
      throw new QuickTradeError("DB_ERROR", "Failed to create quick trade position");
    }

    const resolvedOrderId = inserted.orderId ?? orderId;

    return { id: inserted.id, orderId: resolvedOrderId };
  } catch (error) {
    await logError("quickTrade.insert", error);
    throw new QuickTradeError("DB_ERROR", "Failed to create quick trade position");
  }
}
