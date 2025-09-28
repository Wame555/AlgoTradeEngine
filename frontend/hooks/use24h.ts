import React from "react";

type Item = { symbol: string; priceChangePercent: number; lastPrice: number };

export function useTwentyFourH(symbols: string[], intervalMs = 10000) {
  const [data, setData] = React.useState<Record<string, Item>>({});
  const [ts, setTs] = React.useState<string>("");

  React.useEffect(() => {
    let stop = false;
    async function tick() {
      try {
        const url = `/api/markets/24h?symbols=${encodeURIComponent(JSON.stringify(symbols))}`;
        const r = await fetch(url);
        const j = await r.json();
        if (stop) return;
        if (j?.ok) {
          const map: Record<string, Item> = {};
          for (const it of j.items as Item[]) map[it.symbol] = it;
          setData(map);
          setTs(j.ts);
        }
      } catch {}
    }
    tick();
    const id = setInterval(tick, intervalMs);
    return () => { stop = true; clearInterval(id); };
  }, [JSON.stringify(symbols), intervalMs]);

  return { data, ts };
}
