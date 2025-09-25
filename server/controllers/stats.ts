import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";

import { cached, DEFAULT_CACHE_TTL_MS } from "../cache/apiCache";
import { db } from "../db";
import { positions } from "@shared/schema";
import {
  SUPPORTED_TIMEFRAMES,
  type StatsChangeResponse,
  type SupportedTimeframe,
} from "@shared/types";
import { getLastPrice } from "../state/marketCache";
import { getPrevClose, getChangePct, getPnlForPosition } from "../services/metrics";

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

  try {
    const { value, cacheHit } = await cached(cacheKey, DEFAULT_CACHE_TTL_MS, async () => {
      try {
        const [prevCloseRaw, changePctRaw] = await Promise.all([
          getPrevClose(symbol, timeframe),
          getChangePct(symbol, timeframe),
        ]);

        const lastPriceRaw = getLastPrice(symbol);
        const prevClose = Number.isFinite(prevCloseRaw) ? prevCloseRaw : 0;
        const lastPrice =
          typeof lastPriceRaw === "number" && Number.isFinite(lastPriceRaw) ? lastPriceRaw : 0;
        const changePct = Number.isFinite(changePctRaw) ? changePctRaw : 0;

        const openPositions = await db
          .select()
          .from(positions)
          .where(and(eq(positions.symbol, symbol), eq(positions.status, "OPEN")));

        let pnlTotal = 0;
        for (const position of openPositions) {
          try {
            const pnl = await getPnlForPosition(position, timeframe);
            if (Number.isFinite(pnl)) {
              pnlTotal += pnl;
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
