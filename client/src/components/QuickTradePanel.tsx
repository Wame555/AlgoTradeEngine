// client/src/components/QuickTradePanel.tsx
import React, { useState } from "react";
import type { QuickTradeRequest, QuickTradeResponse, Side, OrderType } from "@shared/types/trade";

const defaultSymbol = "BTCUSDT";

export default function QuickTradePanel() {
  const [symbol, setSymbol] = useState<string>(defaultSymbol);
  const [side, setSide] = useState<Side>("BUY");
  const [type, setType] = useState<OrderType>("MARKET");
  const [quantity, setQuantity] = useState<number>(0.001);
  const [price, setPrice] = useState<number | "">("");
  const [pending, setPending] = useState(false);
  const [lastMsg, setLastMsg] = useState<string>("");

  const onSubmit = async () => {
    console.log("[QuickTrade] clicked", { symbol, side, type, quantity, price });
    setPending(true);
    setLastMsg("");

    const payload: QuickTradeRequest = {
      symbol: symbol?.trim() || defaultSymbol,
      side,
      type,
      quantity: Number(quantity) || 0,
      ...(type === "LIMIT" ? { price: typeof price === "number" ? price : null } : { price: null }),
    };

    try {
      const resp = await fetch("/api/quick-trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await resp.json()) as QuickTradeResponse;

      console.log("[QuickTrade] response", data);
      setLastMsg(`${data.ok ? "OK" : "ERR"}: ${data.message} (requestId=${data?.requestId ?? "-"})`);
    } catch (e: any) {
      console.error("[QuickTrade] fetch error", e?.message || e);
      setLastMsg(`ERR: ${e?.message ?? "Network error"}`);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="quick-trade-panel" style={{ display: "grid", gap: 8, maxWidth: 420 }}>
      <h3>Quick Trade</h3>

      <label>
        Symbol
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="BTCUSDT"
        />
      </label>

      <label>
        Side
        <select value={side} onChange={(e) => setSide(e.target.value as Side)}>
          <option value="BUY">BUY</option>
          <option value="SELL">SELL</option>
        </select>
      </label>

      <label>
        Type
        <select value={type} onChange={(e) => setType(e.target.value as OrderType)}>
          <option value="MARKET">MARKET</option>
          <option value="LIMIT">LIMIT</option>
        </select>
      </label>

      <label>
        Quantity
        <input
          type="number"
          step="0.000001"
          min="0"
          value={quantity}
          onChange={(e) => setQuantity(parseFloat(e.target.value))}
        />
      </label>

      {type === "LIMIT" && (
        <label>
          Price
          <input
            type="number"
            step="0.01"
            min="0"
            value={price}
            onChange={(e) => {
              const v = e.target.value;
              setPrice(v === "" ? "" : parseFloat(v));
            }}
          />
        </label>
      )}

      <button onClick={onSubmit} disabled={pending || !symbol?.trim() || !quantity}>
        {pending ? "Submitting..." : "Quick Trade"}
      </button>

      <div style={{ minHeight: 20, fontSize: 12, opacity: 0.8 }}>
        {lastMsg ?? ""}
      </div>
    </div>
  );
}
