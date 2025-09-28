import Decimal from "decimal.js";

import type { Broker, OrderType, Side as BrokerSide } from "../broker/types";
import type { Position } from "@shared/schema";

import { storage } from "../storage";
import { getLastPrice as getPaperLastPrice } from "../paper/PriceFeed";
import { logError } from "../utils/logger";

export type PlaceOrderParams = {
  symbol: string;
  side: BrokerSide;
  type: OrderType;
  quantity: number;
  price?: number | null;
  requestId: string;
  userId: string;
  leverage?: number | null;
  source?: string;
};

export type PlaceOrderResult = {
  id: string;
  orderId: string | null;
  status: string;
  position: Position;
};

let brokerRef: Broker | null = null;

export function configureOrderService(broker: Broker): void {
  brokerRef = broker;
}

function getBroker(): Broker {
  if (!brokerRef) {
    throw new Error("Order service broker not configured");
  }
  return brokerRef;
}

function resolveFillPrice(fills: Array<{ price: number; qty: number }>): number | null {
  let totalQty = 0;
  let totalValue = 0;
  for (const fill of fills) {
    const qty = Number(fill.qty);
    const price = Number(fill.price);
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) {
      continue;
    }
    totalQty += qty;
    totalValue += price * qty;
  }
  if (totalQty <= 0) {
    return null;
  }
  return totalValue / totalQty;
}

export async function placeOrder(params: PlaceOrderParams): Promise<PlaceOrderResult> {
  const broker = getBroker();
  const symbol = params.symbol.trim().toUpperCase();
  if (!symbol) {
    throw new Error("Symbol is required");
  }
  if (!(params.quantity > 0) || !Number.isFinite(params.quantity)) {
    throw new Error("Quantity must be greater than zero");
  }

  const existing = await storage.getPositionByRequestId(params.requestId);
  if (existing) {
    return {
      id: existing.id,
      orderId: existing.orderId ?? null,
      status: existing.status ?? "OPEN",
      position: existing,
    };
  }

  const orderResult = await broker.placeOrder({
    symbol,
    side: params.side,
    type: params.type,
    qty: params.quantity,
    price: params.type === "LIMIT" ? params.price ?? undefined : undefined,
  });

  const fills = Array.isArray(orderResult?.fills) ? orderResult.fills : [];
  const fillPrice = resolveFillPrice(fills);
  const fallbackPrice = params.price ?? getPaperLastPrice(symbol) ?? null;
  const resolvedPrice = fillPrice ?? fallbackPrice;

  if (!resolvedPrice || !Number.isFinite(resolvedPrice) || resolvedPrice <= 0) {
    throw new Error("Unable to resolve fill price");
  }

  const priceDecimal = new Decimal(resolvedPrice);
  const qtyDecimal = new Decimal(params.quantity);
  const notionalDecimal = qtyDecimal.times(priceDecimal);
  const leverageValue = params.leverage && Number.isFinite(params.leverage)
    ? new Decimal(params.leverage)
    : new Decimal(1);

  const positionSide = params.side === "SELL" ? "SHORT" : "LONG";

  try {
    const position = await storage.createPosition({
      userId: params.userId,
      symbol,
      side: positionSide,
      qty: qtyDecimal.toFixed(8),
      size: notionalDecimal.toFixed(8),
      amountUsd: notionalDecimal.toFixed(2),
      entryPrice: priceDecimal.toFixed(8),
      currentPrice: priceDecimal.toFixed(8),
      leverage: leverageValue.toFixed(2),
      status: "OPEN",
      orderId: orderResult?.orderId ?? null,
      requestId: params.requestId,
    });

    return {
      id: position.id,
      orderId: position.orderId ?? null,
      status: position.status ?? "OPEN",
      position,
    };
  } catch (error) {
    await logError("orders.placeOrder", error);
    const code = (error as { code?: string } | undefined)?.code;
    if (code === "23505") {
      const existingAfter = await storage.getPositionByRequestId(params.requestId);
      if (existingAfter) {
        return {
          id: existingAfter.id,
          orderId: existingAfter.orderId ?? null,
          status: existingAfter.status ?? "OPEN",
          position: existingAfter,
        };
      }
    }
    throw error instanceof Error ? error : new Error(String(error));
  }
}
