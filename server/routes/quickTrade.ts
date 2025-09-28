import { Router } from "express";
import crypto from "node:crypto";

import type { QuickTradeRequest, QuickTradeResponse } from "../../shared/types/trade";

import { ensureDefaultUser } from "../routes";
import { placeOrder } from "../services/orders";

const router = Router();

const isSide = (value: unknown): value is "BUY" | "SELL" => value === "BUY" || value === "SELL";
const isType = (value: unknown): value is "MARKET" | "LIMIT" => value === "MARKET" || value === "LIMIT";

router.post("/api/quick-trade", async (req, res) => {
  const body = (req?.body ?? {}) as Partial<QuickTradeRequest>;

  console.log("[quick-trade] inbound:", {
    symbol: body?.symbol,
    side: body?.side,
    type: body?.type,
    quantity: body?.quantity,
    price: body?.price,
  });

  const symbol =
    typeof body.symbol === "string" && body.symbol.trim().length > 0 ? body.symbol.trim().toUpperCase() : null;
  const side = isSide(body.side) ? body.side : null;
  const type = isType(body.type) ? body.type : null;
  const quantity =
    typeof body.quantity === "number" && Number.isFinite(body.quantity) && body.quantity > 0 ? body.quantity : null;
  const price =
    body.price == null
      ? null
      : typeof body.price === "number" && Number.isFinite(body.price) && body.price > 0
      ? body.price
      : null;

  if (!symbol || !side || !type || !quantity) {
    return res.status(400).json({
      ok: false,
      message: "Invalid payload",
      requestId: "",
      orderId: null,
      status: "rejected",
      ts: new Date().toISOString(),
    } satisfies QuickTradeResponse);
  }

  if (type === "LIMIT" && !price) {
    return res.status(400).json({
      ok: false,
      message: "Price required for LIMIT",
      requestId: "",
      orderId: null,
      status: "rejected",
      ts: new Date().toISOString(),
    } satisfies QuickTradeResponse);
  }

  const requestId = crypto.randomUUID?.() ?? crypto.randomBytes(16).toString("hex");

  try {
    const { user, settings } = await ensureDefaultUser();
    const leverageRaw = Number(settings?.defaultLeverage ?? 1);
    const leverage = Number.isFinite(leverageRaw) && leverageRaw > 0 ? leverageRaw : 1;

    const result = await placeOrder({
      symbol,
      side,
      type,
      quantity,
      price: type === "LIMIT" ? price : null,
      requestId,
      userId: user.id,
      leverage,
      source: "quick-trade",
    });

    console.log("[quick-trade] placed:", {
      requestId,
      orderId: result.orderId,
      status: result.status,
    });

    return res.status(200).json({
      ok: true,
      message: "Order placed",
      requestId,
      orderId: result.orderId,
      status: result.status,
      ts: new Date().toISOString(),
    } satisfies QuickTradeResponse);
  } catch (err: any) {
    console.error("[quick-trade] error:", err?.message || err);
    return res.status(500).json({
      ok: false,
      message: String(err?.message ?? "Internal error"),
      requestId,
      orderId: null,
      status: "error",
      ts: new Date().toISOString(),
    } satisfies QuickTradeResponse);
  }
});

export default router;
