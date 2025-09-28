// server/routes/quickTrade.ts
import { Router } from "express";
import crypto from "node:crypto";
import type { QuickTradeRequest, QuickTradeResponse } from "../../shared/types/trade";

const router = Router();

function isSide(x: unknown): x is "BUY" | "SELL" {
  return x === "BUY" || x === "SELL";
}
function isOrderType(x: unknown): x is "MARKET" | "LIMIT" {
  return x === "MARKET" || x === "LIMIT";
}

router.post("/api/quick-trade", async (req, res) => {
  const body = req?.body as Partial<QuickTradeRequest> | undefined;

  // Belépési log a hívás tényéről
  // (követelmény: legyen valami a logban kattintáskor)
  console.log("[quick-trade] inbound request:", {
    symbol: body?.symbol,
    side: body?.side,
    type: body?.type,
    quantity: body?.quantity,
    price: body?.price,
  });

  // Alap validáció – shared/types-hoz igazítva
  const symbol = typeof body?.symbol === "string" && body.symbol.trim().length > 0 ? body.symbol.trim() : null;
  const side = isSide(body?.side) ? body!.side : null;
  const type = isOrderType(body?.type) ? body!.type : null;
  const quantity = typeof body?.quantity === "number" && Number.isFinite(body.quantity) && body.quantity > 0 ? body.quantity : null;
  const price = body?.price == null
    ? null
    : (typeof body.price === "number" && Number.isFinite(body.price) && body.price > 0 ? body.price : null);

  if (!symbol || !side || !type || !quantity) {
    return res.status(400).json({
      ok: false,
      message: "Invalid payload: symbol, side, type, quantity are required.",
      requestId: "",
      ts: new Date().toISOString(),
    } satisfies QuickTradeResponse);
  }

  if (type === "LIMIT" && !price) {
    return res.status(400).json({
      ok: false,
      message: "Invalid payload: price required for LIMIT orders.",
      requestId: "",
      ts: new Date().toISOString(),
    } satisfies QuickTradeResponse);
  }

  // requestId generálása (text típusú, kompatibilis a projekt konvencióival)
  const requestId = crypto.randomUUID?.() ?? crypto.randomBytes(16).toString("hex");

  try {
    // Itt történne a tényleges megbízás létrehozása / sorba állítása.
    // Minimális, koherens működés: visszaigazoljuk a beérkezést.
    // (Ha van már rendeléskezelő szolgáltatás a projektben, ide később be lehet kötni.)

    console.log("[quick-trade] accepted:", { requestId, symbol, side, type, quantity, price });

    const payload: QuickTradeResponse = {
      ok: true,
      message: "Quick trade request accepted.",
      requestId,
      orderId: null,
      status: "accepted",
      ts: new Date().toISOString(),
    };

    return res.status(200).json(payload);
  } catch (err: any) {
    console.error("[quick-trade] error:", err?.message || err);
    return res.status(500).json({
      ok: false,
      message: err?.message ? String(err.message) : "Internal server error",
      requestId,
      orderId: null,
      status: "error",
      ts: new Date().toISOString(),
    } satisfies QuickTradeResponse);
  }
});

export default router;
