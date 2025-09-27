import type { Request, Response } from "express";
import Decimal from "decimal.js";
import { cached, MICRO_CACHE_TTL_MS } from "../cache/apiCache";
import { storage } from "../storage";
import {
  SUPPORTED_TIMEFRAMES,
  type StatsChangeResponse,
  type SupportedTimeframe,
} from "@shared/types";
import { getPrevClose, getLastPrice, getPnlForPosition } from "../services/metrics";
import { CONFIGURED_SYMBOL_SET } from "../config/symbols";

const TIMEFRAME_SET = new Set<SupportedTimeframe>(SUPPORTED_TIMEFRAMES);

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function buildFallback(
  symbol: string,
  timeframe: SupportedTimeframe,
): StatsChangeResponse {
  return {
    symbol,
    timeframe,
    prevClose: 0,
    lastPrice: 0,
    changePct: 0,
    pnlUsdForOpenPositionsBySymbol: 0,
    partialData: true,
  };
}

function isSupportedTimeframe(value: string): value is SupportedTimeframe {
  return TIMEFRAME_SET.has(value as SupportedTimeframe);
}

export async function change(req: Request, res: Response): Promise<void> {
  const rawSymbol = typeof req.query.symbol === "string" ? req.query.symbol : "";
  const rawTimeframe = typeof req.query.timeframe === "string" ? req.query.timeframe : "";

  if (!rawSymbol || !rawTimeframe || !isSupportedTimeframe(rawTimeframe)) {
    res.status(400).json({ error: true, message: "invalid params" });
    return;
  }

  const symbol = normalizeSymbol(rawSymbol);
  const timeframe = rawTimeframe as SupportedTimeframe;
  const fallback = buildFallback(symbol, timeframe);
  const cacheKey = `stats:change:${symbol}:${timeframe}`;

  if (CONFIGURED_SYMBOL_SET.size === 0 || !CONFIGURED_SYMBOL_SET.has(symbol)) {
    res.json(fallback);
    return;
  }

  try {
    const { value, cacheHit } = await cached(cacheKey, MICRO_CACHE_TTL_MS, async () => {
      try {
        const [prevCloseResult, lastPriceResult] = await Promise.all([
          getPrevClose(symbol, timeframe),
          getLastPrice(symbol),
        ]);

        const prevCloseDecimal = new Decimal(prevCloseResult.value ?? 0);
        const lastPriceDecimal = new Decimal(lastPriceResult.value ?? 0);

        let partialData = prevCloseResult.partialData || lastPriceResult.partialData;

        const prevClose = prevCloseDecimal.isFinite()
          ? prevCloseDecimal.toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toNumber()
          : 0;
        const lastPrice = lastPriceDecimal.isFinite()
          ? lastPriceDecimal.toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toNumber()
          : 0;

        let changePct = 0;
        if (prevCloseDecimal.gt(0) && lastPriceDecimal.gt(0)) {
          const changeDecimal = lastPriceDecimal.minus(prevCloseDecimal).div(prevCloseDecimal).times(100);
          changePct = changeDecimal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
        } else {
          partialData = true;
        }

        const allOpenPositions = await storage.getAllOpenPositions();
        const openPositions = allOpenPositions.filter(
          (position) => normalizeSymbol(position.symbol) === symbol && position.status === "OPEN",
        );

        let pnlTotal = 0;
        for (const position of openPositions) {
          try {
            const pnlResult = await getPnlForPosition(position, timeframe);
            if (Number.isFinite(pnlResult.value)) {
              pnlTotal += pnlResult.value;
            }
            if (pnlResult.partialData) {
              partialData = true;
            }
          } catch {
            // ignore individual position errors
          }
        }

        const pnlUsdForOpenPositionsBySymbol = Number.isFinite(pnlTotal) ? pnlTotal : 0;

        return {
          symbol,
          timeframe,
          prevClose,
          lastPrice,
          changePct,
          pnlUsdForOpenPositionsBySymbol,
          partialData,
        } satisfies StatsChangeResponse;
      } catch (error) {
        console.warn(
          `[stats] failed to compute change for ${symbol} ${timeframe}: ${(error as Error).message ?? error}`,
        );
        return buildFallback(symbol, timeframe);
      }
    });

    if (!cacheHit) {
      console.info(`GET /stats/change {symbol:${symbol}, timeframe:${timeframe}} cacheHit=${cacheHit}`);
    }

    res.json(value);
  } catch (error) {
    console.error(
      `[stats] unexpected failure for ${symbol} ${timeframe}: ${(error as Error).message ?? error}`,
    );
    res.json(fallback);
  }
}
