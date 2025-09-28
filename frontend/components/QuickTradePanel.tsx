import React from "react";
import type { InputMode, OrderType, QuickTradeResponse, Side } from "../../shared/types/trade";
import { buildQuickTrade } from "../lib/buildQuickTrade";

export default function QuickTradePanel() {
  const [symbol, setSymbol] = React.useState<string>("BTCUSDT");
  const [side, setSide] = React.useState<Side>("BUY");
  const [type, setType] = React.useState<OrderType>("MARKET");
  const [mode, setMode] = React.useState<InputMode>("QTY");
  const [qty, setQty] = React.useState<string>("");
  const [usdt, setUsdt] = React.useState<string>("");
  const [price, setPrice] = React.useState<string>("");
  const [lastPrice, setLastPrice] = React.useState<string>("");
  const [pending, setPending] = React.useState(false);
  const [msg, setMsg] = React.useState<string>("");

  React.useEffect(() => {
    console.log("[QuickTrade] mounted");
  }, []);

  const onSubmit = async (e?: React.SyntheticEvent) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    console.log("[QuickTrade] submit clicked");

    const payload = buildQuickTrade({
      symbol, side, type, mode,
      qtyInput: qty, usdtInput: usdt,
      price, lastPrice, qtyStep: 1e-8,
    });

    if (!payload.symbol || (!payload.quantity && !payload.quoteAmount)) {
      setMsg("Fill quantity or USDT"); return;
    }

    setPending(true);
    setMsg("");

    try {
      const resp = await fetch("/api/quick-trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await resp.json()) as QuickTradeResponse;
      console.log("[QuickTrade] response", resp.status, data);

      if (resp.ok && data?.ok) setMsg(`OK: ${data.message} (${data.requestId})`);
      else setMsg(`ERR: ${data?.message ?? "Order failed"}`);
    } catch (err: any) {
      setMsg(`ERR: ${err?.message ?? "Network error"}`);
    } finally {
      setPending(false);
    }
  };

  return (
    <form noValidate onSubmit={onSubmit} className="quick-trade-panel" style={{ display: "grid", gap: 8 }}>
      <h3>Quick Trade</h3>

      <label>Symbol
        <input value={symbol} onChange={(e)=>setSymbol(e.target.value)} placeholder="BTCUSDT" />
      </label>

      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={()=>setMode("QTY")} aria-pressed={mode==="QTY"}>Qty</button>
        <button type="button" onClick={()=>setMode("USDT")} aria-pressed={mode==="USDT"}>USDT</button>
      </div>

      <label>Size
        <input inputMode="decimal" pattern="[0-9]*[.,]?[0-9]*" value={qty} onChange={(e)=>setQty(e.target.value)} placeholder="0.001" />
      </label>

      <label>USDT
        <input inputMode="decimal" pattern="[0-9]*[.,]?[0-9]*" value={usdt} onChange={(e)=>setUsdt(e.target.value)} placeholder="25" />
      </label>

      <label>Type
        <select value={type} onChange={(e)=>setType(e.target.value as OrderType)}>
          <option value="MARKET">MARKET</option>
          <option value="LIMIT">LIMIT</option>
        </select>
      </label>

      {type === "LIMIT" && (
        <label>Price
          <input inputMode="decimal" pattern="[0-9]*[.,]?[0-9]*" value={price} onChange={(e)=>setPrice(e.target.value)} placeholder="30000" />
        </label>
      )}

      <label>Last Price (optional)
        <input inputMode="decimal" pattern="[0-9]*[.,]?[0-9]*" value={lastPrice} onChange={(e)=>setLastPrice(e.target.value)} placeholder="29950" />
      </label>

      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={()=>setSide("BUY")} aria-pressed={side==="BUY"}>Long</button>
        <button type="button" onClick={()=>setSide("SELL")} aria-pressed={side==="SELL"}>Short</button>
      </div>

      <button id="qt-place-order" data-qa="quick-trade-submit" type="submit" onClick={onSubmit} disabled={pending || !symbol?.trim() || (!String(qty ?? "").trim() && !String(usdt ?? "").trim())}>
        Place Order
      </button>

      <div style={{ minHeight: 20, fontSize: 12, opacity: 0.8 }}>{msg}</div>
    </form>
  );
}
