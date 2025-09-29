import { Router } from "express";
import crypto from "node:crypto";
import type { QuickTradeRequest, QuickTradeResponse, Side, OrderType, InputMode } from "../../shared/types/trade";
import { placeOrder } from "../services/orders";
import Decimal from "decimal.js";
import { storage } from "../storage";
import { db } from "../db";
import { users } from "@shared/schema";
import { getAccountSnapshot } from "../state/accountSnapshot";

const router = Router();

const isSide = (x: any): x is Side => x === "BUY" || x === "SELL";
const isType = (x: any): x is OrderType => x === "MARKET" || x === "LIMIT";
const isMode = (x: any): x is InputMode => x === "USDT" || x === "QTY";

function toNumLocale(input: any): number {
  const n = Number(input);
  return Number.isFinite(n) ? n : 0;
}

router.post("/quick-trade", async (req, res) => {
  console.log("[quick-trade] inbound");

  const b = (req?.body ?? {}) as Partial<QuickTradeRequest>;
  const symbol = typeof b.symbol === "string" && b.symbol.trim() ? b.symbol.trim() : null;
  const side = isSide(b.side) ? b.side : null;
  const type = isType(b.type) ? b.type : null;
  const mode = isMode(b.mode) ? b.mode : "QTY";

  const qtyIn = toNumLocale(b.quantity as any);
  const priceIn = b.price == null ? null : toNumLocale(b.price as any);
  const lastPriceIn = b.lastPrice == null ? null : toNumLocale(b.lastPrice as any);
  const quoteIn = b.quoteAmount == null ? null : toNumLocale(b.quoteAmount as any);

  if (!symbol || !side || !type) {
    return res.status(400).json(<QuickTradeResponse>{
      ok: false, message: "Invalid payload: symbol/side/type required", requestId: "", ts: new Date().toISOString(),
    });
  }

  let usedPrice: number | null = null;
  if (type === "LIMIT") {
    if (!priceIn || priceIn <= 0) {
      return res.status(400).json(<QuickTradeResponse>{
        ok: false, message: "Price required for LIMIT", requestId: "", ts: new Date().toISOString(),
      });
    }
    usedPrice = priceIn;
  } else {
    usedPrice = priceIn ?? lastPriceIn ?? null;
  }

  let qty: number | null = qtyIn && qtyIn > 0 ? qtyIn : null;
  if ((!qty || qty <= 0) && quoteIn && quoteIn > 0 && usedPrice && usedPrice > 0) {
    qty = Math.floor((quoteIn / usedPrice) * 1e8 + 1e-9) / 1e8;
  }
  if (!qty || qty <= 0) {
    return res.status(400).json(<QuickTradeResponse>{
      ok: false, message: "Quantity is required (direct or derived).", requestId: "", ts: new Date().toISOString(),
    });
  }

  // Compute equity and validate available balance
  try {
    // Determine current account equity
    let userId: string | undefined;
    const [user] = await db.select({ id: users.id }).from(users).limit(1);
    if (user) {
      userId = user.id;
    }
    const settings = userId ? await storage.getUserSettings(userId) : undefined;
    const snapshot = getAccountSnapshot();
    const totalBalanceDecimal = snapshot
      ? new Decimal(snapshot.totalBalance)
      : new Decimal(settings?.totalBalance ?? settings?.initialBalance ?? 0);
    const equityDecimal = snapshot?.equity != null ? new Decimal(snapshot.equity) : totalBalanceDecimal;
    if (mode === "USDT") {
      const quoteDecimal = new Decimal(quoteIn ?? 0);
      console.log(`[trade] parsed quantity: ${qty} ${symbol} from ${quoteDecimal.toNumber()} USDT @ $${usedPrice}`);
      if (quoteDecimal.gt(equityDecimal)) {
        console.warn(`[trade] insufficient equity: require ${quoteDecimal.toNumber()} USDT, have ${equityDecimal.toNumber()} USDT`);
        return res.status(400).json(<QuickTradeResponse>{
          ok: false,
          error: "Insufficient equity",
          message: "Insufficient equity",
          requestId: "",
          ts: new Date().toISOString(),
        });
      }
    } else {
      const usedPx = new Decimal(usedPrice ?? 0);
      const qtyDecimal = new Decimal(qty);
      const costDecimal = qtyDecimal.times(usedPx);
      console.log(`[trade] parsed cost: ${costDecimal.toNumber()} USDT for ${qty} ${symbol} @ $${usedPx.toNumber()}`);
      if (costDecimal.gt(equityDecimal)) {
        console.warn(`[trade] insufficient equity: require ${costDecimal.toNumber()} USDT, have ${equityDecimal.toNumber()} USDT`);
        return res.status(400).json(<QuickTradeResponse>{
          ok: false,
          error: "Insufficient equity",
          message: "Insufficient equity",
          requestId: "",
          ts: new Date().toISOString(),
        });
      }
    }
  } catch (err) {
    console.error("[trade] equity validation error:", err);
  }

  const requestId = (typeof b.requestId === "string" && b.requestId) || crypto.randomUUID?.() || crypto.randomBytes(16).toString("hex");

  try {
    const result = await placeOrder({
      symbol,
      side,
      type,
      quantity: qty,
      price: type === "LIMIT" ? usedPrice! : undefined,
      requestId,
      source: "quick-trade",
    });

    console.log("[quick-trade] placed:", { requestId, orderId: (result as any)?.id });

    return res.status(200).json(<QuickTradeResponse>{
      ok: true,
      message: "Order placed",
      requestId,
      orderId: (result as any)?.id ?? null,
      status: (result as any)?.status ?? "submitted",
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
      quantity: qty ?? null,
      price: usedPrice,
      quoteAmount: quoteIn ?? (usedPrice && qty ? qty * usedPrice : null),
    });
  }
});

export default router;
