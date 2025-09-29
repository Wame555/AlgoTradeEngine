import { useEffect, useMemo, useRef, useState } from "react";

interface Market24hItem {
  priceChangePercent: number | null;
  lastPrice: number | null;
}

interface ApiResponseItem {
  symbol?: string;
  changePct?: number | null;
  last?: number | null;
}

interface ApiResponseBody {
  items?: ApiResponseItem[];
}

function normalizeSymbols(input: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const raw of input) {
    if (!raw) continue;
    const symbol = raw.trim().toUpperCase();
    if (symbol) {
      unique.add(symbol);
    }
  }
  return Array.from(unique);
}

export function useTwentyFourH(symbols: readonly string[], intervalMs: number = 10000) {
  const [data, setData] = useState<Record<string, Market24hItem>>({});
  const [ts, setTs] = useState<string>("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const normalizedSymbols = useMemo(() => normalizeSymbols(symbols), [symbols]);
  const symbolKey = useMemo(() => normalizedSymbols.join(","), [normalizedSymbols]);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      const params = new URLSearchParams();
      if (normalizedSymbols.length > 0) {
        params.set("symbols", normalizedSymbols.join(","));
      }

      const query = params.toString();
      const url = `/api/market/24h${query ? `?${query}` : ""}`;

      try {
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) {
          console.warn(`[useTwentyFourH] request failed: ${res.status}`);
          return;
        }

        const body: ApiResponseBody = await res.json();
        if (cancelled) {
          return;
        }

        const next: Record<string, Market24hItem> = {};
        for (const item of body.items ?? []) {
          if (!item || typeof item.symbol !== "string") {
            continue;
          }

          const symbol = item.symbol.trim().toUpperCase();
          if (!symbol) {
            continue;
          }

          const pct = typeof item.changePct === "number" && Number.isFinite(item.changePct)
            ? item.changePct
            : item.changePct != null && Number.isFinite(Number(item.changePct))
            ? Number(item.changePct)
            : null;
          const last = typeof item.last === "number" && Number.isFinite(item.last)
            ? item.last
            : item.last != null && Number.isFinite(Number(item.last))
            ? Number(item.last)
            : null;

          next[symbol] = {
            priceChangePercent: pct,
            lastPrice: last,
          };
        }

        setData(next);
        setTs(new Date().toISOString());
      } catch (error) {
        if (!cancelled) {
          console.warn("[useTwentyFourH] fetch error", error);
        }
      }
    }

    void load();
    if (intervalMs > 0) {
      timerRef.current = setInterval(() => {
        void load();
      }, intervalMs);
    }

    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [intervalMs, symbolKey, normalizedSymbols]);

  return { data, ts };
}
