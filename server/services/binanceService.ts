import WebSocket from "ws";
import { db } from "../db";
import { sql } from "drizzle-orm";

type ExchangeInfoSymbol = {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  filters?: Array<{
    filterType: string;
    stepSize?: string;
    tickSize?: string;
    minQty?: string;
    minNotional?: string;
  }>;
};

type ExchangeInfoResponse = {
  symbols?: ExchangeInfoSymbol[];
};

export interface BinanceOrder {
  orderId: string;
  symbol: string;
  side: string;
  status: string;
  price: string;
  origQty: string;
  executedQty: string;
}

export interface PriceData {
  symbol: string;
  price: string;
  change24h?: string;
  volume24h?: string;
  high24h?: string;
  low24h?: string;
}

export interface SymbolExchangeFilters {
  stepSize?: number;
  minQty?: number;
  minNotional?: number;
}

export class BinanceService {
  private SUPPORTED_PAIRS = [
    "ETHUSDT",
    "BTCUSDT",
    "AVAXUSDT",
    "SOLUSDT",
    "DOTUSDT",
    "ENJUSDT",
    "ADAUSDT",
    "GALAUSDT",
    "EGLDUSDT",
    "SNXUSDT",
    "MANAUSDT",
    "ARPAUSDT",
    "SEIUSDT",
    "ACHUSDT",
    "ATOMUSDT",
  ];

  private isTestnet: boolean = true;
  private market: "spot" | "futures" = "spot";
  private wsBase: string;
  private restBase: string;
  private streamSuffix: string;
  private exchangeInfoCache: { data: ExchangeInfoResponse; fetchedAt: number } | null = null;

  private apiKey: string | null = null;
  private apiSecret: string | null = null;

  constructor() {
    this.isTestnet = (process.env.BINANCE_TESTNET ?? "true") !== "false";
    this.market = (process.env.BINANCE_MARKET as any) === "futures" ? "futures" : "spot";

    const autoWs =
      this.market === "futures"
        ? this.isTestnet
          ? "wss://stream.binancefuture.com"
          : "wss://fstream.binance.com"
        : this.isTestnet
        ? "wss://testnet.binance.vision"
        : "wss://stream.binance.com:9443";

    const autoRest =
      this.market === "futures"
        ? this.isTestnet
          ? "https://testnet.binancefuture.com"
          : "https://fapi.binance.com"
        : this.isTestnet
        ? "https://testnet.binance.vision"
        : "https://api.binance.com";

    this.wsBase = process.env.BINANCE_WS_BASE || autoWs;
    this.restBase = process.env.BINANCE_REST_BASE || autoRest;
    this.streamSuffix = process.env.BINANCE_STREAM_SUFFIX || (this.market === "futures" ? "aggTrade" : "ticker");
  }

  private get restPrefix(): string {
    return this.market === "futures" ? "/fapi/v1" : "/api/v3";
  }

  private async fetchExchangeInfo(forceRefresh: boolean = false): Promise<ExchangeInfoResponse> {
    const CACHE_TTL = 5 * 60 * 1000;
    const now = Date.now();

    if (!forceRefresh && this.exchangeInfoCache && now - this.exchangeInfoCache.fetchedAt < CACHE_TTL) {
      return this.exchangeInfoCache.data;
    }

    try {
      const response = await fetch(`${this.restBase}${this.restPrefix}/exchangeInfo`);
      if (!response.ok) {
        throw new Error(`exchangeInfo HTTP ${response.status}`);
      }
      const data: ExchangeInfoResponse = await response.json();
      this.exchangeInfoCache = { data, fetchedAt: now };
      return data;
    } catch (error) {
      console.error("Error fetching exchange info:", error);
      if (this.exchangeInfoCache) {
        return this.exchangeInfoCache.data;
      }
      throw error;
    }
  }

  updateCredentials(apiKey: string, apiSecret: string, isTestnet: boolean = true) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.isTestnet = isTestnet;

    const autoWs =
      this.market === "futures"
        ? this.isTestnet
          ? "wss://stream.binancefuture.com"
          : "wss://fstream.binance.com"
        : this.isTestnet
        ? "wss://testnet.binance.vision"
        : "wss://stream.binance.com:9443";

    const autoRest =
      this.market === "futures"
        ? this.isTestnet
          ? "https://testnet.binancefuture.com"
          : "https://fapi.binance.com"
        : this.isTestnet
        ? "https://testnet.binance.vision"
        : "https://api.binance.com";

    this.wsBase = process.env.BINANCE_WS_BASE || autoWs;
    this.restBase = process.env.BINANCE_REST_BASE || autoRest;
    this.exchangeInfoCache = null;
  }

  async initializeTradingPairs() {
    try {
      const exchangeInfo = await this.fetchExchangeInfo();
      const symbolInfoMap = new Map<string, ExchangeInfoSymbol>();
      exchangeInfo.symbols?.forEach((info) => {
        symbolInfoMap.set(info.symbol, info);
      });

      for (const symbol of this.SUPPORTED_PAIRS) {
        const info = symbolInfoMap.get(symbol);
        const lotFilter = info?.filters?.find((filter) => filter.filterType === "LOT_SIZE");
        const priceFilter = info?.filters?.find((filter) => filter.filterType === "PRICE_FILTER");
        const notionalFilter = info?.filters?.find((filter) => filter.filterType === "MIN_NOTIONAL");

        const baseAsset = info?.baseAsset ?? symbol.replace("USDT", "");
        const quoteAsset = info?.quoteAsset ?? "USDT";
        const minNotional = notionalFilter?.minNotional ?? null;
        const minQty = lotFilter?.minQty ?? null;
        const stepSize = lotFilter?.stepSize ?? null;
        const tickSize = priceFilter?.tickSize ?? null;

        const values = {
          symbol,
          baseAsset,
          quoteAsset,
          isActive: true,
          minNotional: minNotional ? String(minNotional) : null,
          minQty: minQty ? String(minQty) : null,
          stepSize: stepSize ? String(stepSize) : null,
          tickSize: tickSize ? String(tickSize) : null,
        } as any;

        await db.execute(
          sql`
            INSERT INTO public.trading_pairs (
              symbol,
              base_asset,
              quote_asset,
              is_active,
              min_notional,
              min_qty,
              step_size,
              tick_size
            )
            VALUES (
              ${values.symbol},
              ${values.baseAsset},
              ${values.quoteAsset},
              ${values.isActive},
              ${values.minNotional},
              ${values.minQty},
              ${values.stepSize},
              ${values.tickSize}
            )
            ON CONFLICT ON CONSTRAINT trading_pairs_symbol_uniq
            DO UPDATE SET
              base_asset = EXCLUDED.base_asset,
              quote_asset = EXCLUDED.quote_asset,
              is_active = EXCLUDED.is_active,
              min_notional = EXCLUDED.min_notional,
              min_qty = EXCLUDED.min_qty,
              step_size = EXCLUDED.step_size,
              tick_size = EXCLUDED.tick_size;
          `,
        );
      }
    } catch (error) {
      console.error("Error initializing trading pairs:", error);
    }
  }

  async getSymbolFilters(symbol: string): Promise<SymbolExchangeFilters | null> {
    try {
      const exchangeInfo = await this.fetchExchangeInfo();
      const info = exchangeInfo.symbols?.find((item) => item.symbol === symbol);
      if (!info) {
        return null;
      }

      const lotFilter = info.filters?.find((filter) => filter.filterType === "LOT_SIZE");
      const notionalFilter = info.filters?.find((filter) => filter.filterType === "MIN_NOTIONAL");

      return {
        stepSize: lotFilter?.stepSize ? Number(lotFilter.stepSize) : undefined,
        minQty: lotFilter?.minQty ? Number(lotFilter.minQty) : undefined,
        minNotional: notionalFilter?.minNotional ? Number(notionalFilter.minNotional) : undefined,
      };
    } catch (error) {
      console.error(`Error fetching filters for ${symbol}:`, error);
      return null;
    }
  }

  startPriceStreams(onUpdate: (data: PriceData) => void) {
    this.SUPPORTED_PAIRS.forEach((symbol) => {
      this.startPriceStream(symbol, onUpdate);
    });
  }

  private startPriceStream(symbol: string, onUpdate: (data: PriceData) => void) {
    try {
      const stream = `${symbol.toLowerCase()}@${this.streamSuffix}`;
      const url = `${this.wsBase}/stream?streams=${stream}`;
      const ws = new WebSocket(url);

      ws.onopen = () => {
        console.log(`Connected to ${symbol} price stream: ${url}`);
      };

      ws.onmessage = (event) => {
        try {
          const raw = JSON.parse(event.data.toString());
          const data = raw?.data ?? raw;
          if (data?.e === "aggTrade") {
            const priceData: PriceData = {
              symbol: symbol,
              price: data.p,
            };
            onUpdate(priceData);
          } else if (data?.s && (data.c || data.a || data.p)) {
            const priceData: PriceData = {
              symbol: data.s,
              price: data.c ?? data.a ?? data.p,
              change24h: data.P,
              volume24h: data.v,
              high24h: data.h,
              low24h: data.l,
            };
            onUpdate(priceData);
          }
        } catch (err) {
          console.error(`Parse error for ${symbol} message:`, err);
        }
      };

      ws.onerror = (error: any) => {
        console.warn(`WebSocket error for ${symbol}:`, error?.message || error);
      };

      ws.onclose = (code) => {
        console.log(`Disconnected from ${symbol} price stream (${code}). Reconnecting in 5s...`);
        setTimeout(() => this.startPriceStream(symbol, onUpdate), 5000);
      };
    } catch (error) {
      console.error(`Error starting price stream for ${symbol}:`, error);
    }
  }

  async get24hrTicker(symbol?: string) {
    try {
      const url = symbol
        ? `${this.restBase}${this.restPrefix}/ticker/24hr?symbol=${symbol}`
        : `${this.restBase}${this.restPrefix}/ticker/24hr`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`24hr HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error("Error fetching 24hr ticker:", error);
      return null;
    }
  }

  async createOrder(
    symbol: string,
    side: "LONG" | "SHORT",
    quantity: number,
    stopLoss?: number,
    takeProfit?: number,
  ): Promise<BinanceOrder | null> {
    try {
      if (!this.apiKey || !this.apiSecret) {
        console.error("Binance API credentials not configured");
        return null;
      }
      console.warn("createOrder not implemented yet (signed endpoint required)");
      return null;
    } catch (error) {
      console.error("Error creating order:", error);
      return null;
    }
  }

  async cancelOrder(symbol: string, orderId: string): Promise<boolean> {
    try {
      if (!this.apiKey || !this.apiSecret) {
        console.error("Binance API credentials not configured");
        return false;
      }
      console.warn("cancelOrder not implemented yet (signed endpoint required)");
      return false;
    } catch (error) {
      console.error("Error cancelling order:", error);
      return false;
    }
  }

  async getKlines(symbol: string, timeframe: string, limit: number = 500) {
    try {
      const response = await fetch(
        `${this.restBase}${this.restPrefix}/klines?symbol=${symbol}&interval=${timeframe}&limit=${limit}`,
      );
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Error fetching klines:", error);
      return null;
    }
  }
}
