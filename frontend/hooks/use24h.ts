import React from "react";

type Item = { symbol: string; priceChangePercent: number; lastPrice: number };

export function useTwentyFourH(symbols: string[], intervalMs = 10000) {
  const [data, setData] = React.useState<Record<string, Item>>({});
  const [ts, setTs] = React.useState<string>("");

  React.useEffect(() => {
    let stop = false;
    async function loadAndPoll() {
      let list = symbols;
      if (!list || list.length === 0) {
        try {
          const r = await fetch("/api/pairs");
          const j = await r.json();
          if (j?.ok && Array.isArray(j.symbols) && j.symbols.length) list = j.symbols as string[];
        } catch {}
      }
      if (!list || list.length === 0) return;

      async function tick() {
        try {
          const url = `/api/markets/24h?symbols=${encodeURIComponent(JSON.stringify(list!))}`;
          const r = await fetch(url);
          const j = await r.json();
          if (!stop && j?.ok) {
            const arr = Array.isArray(j.items) ? (j.items as Item[]) : [];
            const map: Record<string, Item> = {};
            for (const it of arr) map[it.symbol] = it;
            setData(map);
            setTs(j.ts ?? "");
          }
        } catch {}
      }
      await tick();
      const id = setInterval(tick, intervalMs);
      return () => clearInterval(id);
    }
    let cleanup: (() => void) | undefined;
    loadAndPoll().then((c) => {
      cleanup = typeof c === "function" ? c : undefined;
    });
    return () => {
      stop = true;
      if (cleanup) cleanup();
    };
  }, [JSON.stringify(symbols), intervalMs]);

  return { data, ts };
}
