// server/routes/quickTrade.ts
import { Router } from "express";
import crypto from "node:crypto";
import type {
  QuickTradeRequest,
  QuickTradeResponse,
  Side,
  OrderType,
  InputMode,
} from "../../shared/types/trade";
import { ensureDefaultUser } from "../routes";
import { placeOrder } from "../services/orders";

const router = Router();

const isSide = (x: unknown): x is Side => x === "BUY" || x === "SELL";
const isType = (x: unknown): x is OrderType => x === "MARKET" || x === "LIMIT";
const isMode = (x: unknown): x is InputMode => x === "USDT" || x === "QTY";

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

router.post("/quick-trade", async (req, res) => {
  console.log("[quick-trade] inbound");
  const b = (req?.body ?? {}) as Partial<QuickTradeRequest>;

  const symbol = typeof b.symbol === "string" && b.symbol.trim() ? b.symbol.trim() : null;
  const side = isSide(b.side) ? b.side : null;
  const type = isType(b.type) ? b.type : null;

  const quantityIn = toNum(b.quantity);
  const priceIn = b.price == null ? null : toNum(b.price);
  const lastPriceIn = b.lastPrice == null ? null : toNum(b.lastPrice);
  const quoteIn = b.quoteAmount == null ? null : toNum(b.quoteAmount);
  const mode = isMode(b.mode) ? b.mode : null;

  console.log("[quick-trade] payload:", {
    symbol,
    side,
    type,
    quantityIn,
    priceIn,
    lastPriceIn,
    quoteIn,
    mode,
  });

  if (!symbol || !side || !type) {
    return res.status(400).json(<QuickTradeResponse>{
      ok: false,
      message: "Invalid payload: symbol/side/type required",
      requestId: "",
      ts: new Date().toISOString(),
    });
  }

  let usedPrice: number | null = null;
  if (type === "LIMIT") {
    if (!priceIn || priceIn <= 0) {
      return res.status(400).json(<QuickTradeResponse>{
        ok: false,
        message: "Price required for LIMIT",
        requestId: "",
        ts: new Date().toISOString(),
      });
    }
    usedPrice = priceIn;
  } else {
    usedPrice = priceIn ?? lastPriceIn ?? null;
  }

  let qty: number | null = quantityIn && quantityIn > 0 ? quantityIn : null;

  if ((!qty || qty <= 0) && quoteIn && quoteIn > 0) {
    if (!usedPrice || usedPrice <= 0) {
      return res.status(400).json(<QuickTradeResponse>{
        ok: false,
        message: "Price is required to derive quantity from USDT (provide price or lastPrice).",
        requestId: "",
        ts: new Date().toISOString(),
      });
    }
    qty = roundToStep(quoteIn / usedPrice, 1e-8);
  }

  if (!qty || qty <= 0) {
    return res.status(400).json(<QuickTradeResponse>{
      ok: false,
      message: "Quantity is required (directly or derived from USDT).",
      requestId: "",
      ts: new Date().toISOString(),
    });
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
      quantity: qty,
      price: usedPrice,
      requestId,
      userId: user.id,
      leverage,
      source: "quick-trade",
    });

    console.log("[quick-trade] placed:", { requestId, resultId: result.id });

    return res.status(200).json(<QuickTradeResponse>{
      ok: true,
      message: "Order placed",
      requestId,
      orderId: result.orderId ?? null,
      status: result.status ?? "submitted",
      ts: new Date().toISOString(),
      symbol,
      quantity: qty,
      price: usedPrice,
      quoteAmount: quoteIn ?? (usedPrice ? qty * usedPrice : null),
    });
  } catch (err: any) {
    console.error("[quick-trade] error:", err?.message || err);
    return res.status(500).json(<QuickTradeResponse>{
      ok: false,
      message: String(err?.message ?? "Internal error"),
      requestId,
      orderId: null,
      status: "error",
      ts: new Date().toISOString(),
      symbol,
      quantity: qty,
      price: usedPrice,
      quoteAmount: quoteIn ?? (usedPrice ? (qty ?? 0) * usedPrice : null),
    });
  }
});

export default router;
