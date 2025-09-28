import { Router } from "express";

const router = Router();

// simple in-memory cache
const cache = new Map<string, { ts: number; data: any }>();
const TTL_MS = 10_000;

router.get("/markets/24h", async (req, res) => {
  try {
    const raw = String(req.query.symbols ?? "[]");
    let symbols: string[] = [];
    try {
      symbols = JSON.parse(raw);
      if (!Array.isArray(symbols)) symbols = [];
    } catch {
      const s = String(req.query.symbol ?? "").trim();
      if (s) symbols = [s];
    }

    if (symbols.length === 0) {
      return res.status(400).json({ ok: false, message: "symbols query required (JSON array) or symbol" });
    }

    const key = symbols.sort().join(",");
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && now - hit.ts < TTL_MS) {
      return res.json({ ok: true, ts: new Date(hit.ts).toISOString(), items: hit.data });
    }

    const url = symbols.length === 1
      ? `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbols[0])}`
      : `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(symbols))}`;

    const r = await fetch(url);
    if (!r.ok) throw new Error(`upstream ${r.status}`);

    const json = await r.json();
    const list = Array.isArray(json) ? json : [json];

    const items = list.map((it: any) => ({
      symbol: String(it.symbol),
      lastPrice: Number(it.lastPrice ?? it.lastPrice ?? it.lastPrice),
      priceChangePercent: Number(it.priceChangePercent),
      highPrice: Number(it.highPrice),
      lowPrice: Number(it.lowPrice),
      volume: Number(it.volume),
    }));

    cache.set(key, { ts: now, data: items });
    return res.json({ ok: true, ts: new Date(now).toISOString(), items });
  } catch (e: any) {
    console.error("[markets/24h] error:", e?.message || e);
    return res.status(500).json({ ok: false, message: "markets/24h error" });
  }
});

export default router;
