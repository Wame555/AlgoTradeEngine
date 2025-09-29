import { Router } from "express";
import { DEFAULT_PAIRS } from "../config/defaultPairs";

const router = Router();
const cache = new Map<string, { ts: number; data: any }>();
const TTL_MS = 10_000;

router.get("/markets/24h", async (req, res) => {
  try {
    let symbols: string[] = [];
    const raw = String(req.query.symbols ?? "");
    if (raw) {
      try { const arr = JSON.parse(raw); if (Array.isArray(arr)) symbols = arr.filter(s => typeof s === "string" && s.trim()); } catch {}
    }
    if (symbols.length === 0) symbols = DEFAULT_PAIRS.slice(0, 15);

    const key = symbols.join(",");
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && now - hit.ts < TTL_MS) return res.json({ ok: true, ts: new Date(hit.ts).toISOString(), items: hit.data });

    const url = symbols.length === 1
      ? `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbols[0])}`
      : `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(symbols))}`;

    const r = await fetch(url);
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    const json = await r.json();
    const list = Array.isArray(json) ? json : [json];

    const items = list.map((it: any) => ({
      symbol: String(it.symbol),
      lastPrice: Number(it.lastPrice ?? 0),
      priceChangePercent: Number(it.priceChangePercent ?? 0),
      highPrice: Number(it.highPrice ?? 0),
      lowPrice: Number(it.lowPrice ?? 0),
      volume: Number(it.volume ?? 0),
    }));

    cache.set(key, { ts: now, data: items });
    return res.json({ ok: true, ts: new Date(now).toISOString(), items });
  } catch (e: any) {
    console.error("[markets/24h] error:", e?.message || e);
    return res.status(500).json({ ok: false, message: "markets/24h error" });
  }
});

export default router;
