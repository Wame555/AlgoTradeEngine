import "dotenv/config";

const BASE_URL = "https://fapi.binance.com";

const RETRY_DELAYS_MS = [250, 500, 1000] as const;
const MAX_ATTEMPTS = 3;

export type FuturesTimeframe =
  | "1m"
  | "3m"
  | "5m"
  | "15m"
  | "1h"
  | "4h"
  | "1d"
  | "1w"
  | "1M";

export interface BinanceKline {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTime: number;
}

export interface FetchKlinesParams {
  symbol: string;
  interval: FuturesTimeframe;
  startTime: number;
  endTime: number;
  limit: number;
}

export interface FetchKlinesResult {
  klines: BinanceKline[];
  usedWeight?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function mapRawKline(row: unknown[]): BinanceKline {
  return {
    openTime: Number(row[0]),
    open: String(row[1]),
    high: String(row[2]),
    low: String(row[3]),
    close: String(row[4]),
    volume: String(row[5]),
    closeTime: Number(row[6]),
  };
}

export class BinanceFuturesClient {
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = BASE_URL;
  }

  async fetchKlines(params: FetchKlinesParams): Promise<FetchKlinesResult> {
    const searchParams = new URLSearchParams({
      symbol: params.symbol,
      interval: params.interval,
      limit: String(params.limit),
      startTime: String(params.startTime),
      endTime: String(params.endTime),
    });

    const url = `${this.baseUrl}/fapi/v1/klines?${searchParams.toString()}`;

    let lastUsedWeight: number | undefined;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const usedWeightHeader = response.headers.get("x-mbx-used-weight-1m");
      const usedWeight = usedWeightHeader ? Number(usedWeightHeader) : undefined;
      if (typeof usedWeight === "number" && Number.isFinite(usedWeight)) {
        lastUsedWeight = usedWeight;
      }

      if (response.status === 429) {
        const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
        console.warn(
          `[backfill] Binance rate limit hit for ${params.symbol} ${params.interval}, retrying in ${delay}ms (attempt ${
            attempt + 1
          })`,
        );
        if (attempt === MAX_ATTEMPTS - 1) {
          console.warn(
            `[backfill] Binance rate limit exhausted after ${MAX_ATTEMPTS} attempts for ${params.symbol} ${params.interval}. Skipping timeframe.`,
          );
          return { klines: [], usedWeight: lastUsedWeight };
        }
        await sleep(delay);
        continue;
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Binance klines HTTP ${response.status}: ${text}`);
      }

      const payload = (await response.json()) as unknown[];
      const klines = Array.isArray(payload) ? payload.map((row) => mapRawKline(row as unknown[])) : [];

      return { klines, usedWeight };
    }

    return { klines: [], usedWeight: lastUsedWeight };
  }
}
