import type { Position } from "@shared/schema";

interface RiskWatcherDeps {
  fetchOpenPositions: () => Promise<Position[]>;
  resolveLastPrice: (symbol: string) => number | undefined;
  onTrigger: (position: Position, trigger: "TP" | "SL", executionPrice: number) => Promise<void> | void;
  intervalMs?: number;
  cacheTtlMs?: number;
}

const DEFAULT_INTERVAL_MS = 750;
const DEFAULT_CACHE_TTL_MS = 1000;

const parseNumeric = (value: unknown): number | undefined => {
  if (value == null) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const resolveQty = (position: Position): number => {
  const storedQty = parseNumeric(position.qty);
  if (typeof storedQty === "number" && storedQty > 0) {
    return Number(storedQty.toFixed(8));
  }
  const sizeUsd = parseNumeric(position.size);
  const entry = parseNumeric(position.entryPrice);
  if (typeof sizeUsd === "number" && typeof entry === "number" && entry > 0) {
    const computed = sizeUsd / entry;
    return Number.isFinite(computed) ? Number(computed.toFixed(8)) : 0;
  }
  return 0;
};

const parsePriceTarget = (position: Position): { tp?: number; sl?: number } => {
  const tp = parseNumeric(position.tpPrice ?? position.takeProfit);
  const sl = parseNumeric(position.slPrice ?? position.stopLoss);
  return {
    tp: typeof tp === "number" && tp > 0 ? tp : undefined,
    sl: typeof sl === "number" && sl > 0 ? sl : undefined,
  };
};

export function startRiskWatcher(deps: RiskWatcherDeps): { stop: () => void } {
  const { fetchOpenPositions, resolveLastPrice, onTrigger, intervalMs = DEFAULT_INTERVAL_MS, cacheTtlMs = DEFAULT_CACHE_TTL_MS } = deps;

  let cachedPositions: Position[] = [];
  let lastFetch = 0;
  let running = false;

  const fetchPositions = async (): Promise<Position[]> => {
    const now = Date.now();
    if (now - lastFetch < cacheTtlMs && cachedPositions.length > 0) {
      return cachedPositions;
    }
    const positions = await fetchOpenPositions();
    cachedPositions = positions;
    lastFetch = now;
    return positions;
  };

  const evaluate = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      const positions = await fetchPositions();
      if (!Array.isArray(positions) || positions.length === 0) {
        return;
      }

      const handled = new Set<string>();
      for (const position of positions) {
        if (!position || handled.has(String(position.id ?? ""))) {
          continue;
        }
        const qty = resolveQty(position);
        if (!Number.isFinite(qty) || qty <= 0) {
          continue;
        }
        const lastPrice = resolveLastPrice(position.symbol);
        if (!Number.isFinite(lastPrice ?? NaN)) {
          continue;
        }
        const targets = parsePriceTarget(position);
        if (!targets.tp && !targets.sl) {
          continue;
        }

        const side = String(position.side ?? "").toUpperCase();
        const price = lastPrice as number;
        let trigger: "TP" | "SL" | null = null;

        if (side === "LONG") {
          if (targets.tp && price >= targets.tp) {
            trigger = "TP";
          } else if (targets.sl && price <= targets.sl) {
            trigger = "SL";
          }
        } else if (side === "SHORT") {
          if (targets.tp && price <= targets.tp) {
            trigger = "TP";
          } else if (targets.sl && price >= targets.sl) {
            trigger = "SL";
          }
        }

        if (trigger) {
          handled.add(String(position.id ?? ""));
          try {
            await onTrigger(position, trigger, price);
            cachedPositions = cachedPositions.filter((cached) => String(cached.id ?? "") !== String(position.id ?? ""));
            lastFetch = 0;
          } catch (error) {
            console.error(
              `[riskWatcher] failed to close ${position.symbol} ${position.side} via ${trigger}: ${(error as Error).message ?? error}`,
            );
          }
        }
      }
    } catch (error) {
      console.error(`[riskWatcher] evaluation failed: ${(error as Error).message ?? error}`);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void evaluate();
  }, Math.max(intervalMs, 100));

  void evaluate();

  return {
    stop: () => {
      clearInterval(timer);
    },
  };
}
