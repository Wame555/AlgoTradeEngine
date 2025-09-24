import { storage } from "../storage";
import WebSocket from "ws";
import { db } from "../db";
import { tradingPairs } from "@shared/schema";

/**
 * Binance connectivity (spot/futures, testnet/mainnet) with:
 * - Combined stream endpoint (no 404 on testnet)
 * - No mock price generation
 * - Env-configurable REST/WS bases and stream suffix
 *
 * ENV (optional):
 *   BINANCE_TESTNET=true|false            # default: true
 *   BINANCE_MARKET=spot|futures           # default: spot
 *   BINANCE_WS_BASE=...                   # overrides autodetected WS base
 *   BINANCE_REST_BASE=...                 # overrides autodetected REST base
 *   BINANCE_STREAM_SUFFIX=ticker|aggTrade # default: ticker for spot, aggTrade for futures
 */
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

export class BinanceService {
  private SUPPORTED_PAIRS = [
    'ETHUSDT', 'BTCUSDT', 'AVAXUSDT', 'SOLUSDT', 'DOTUSDT',
    'ENJUSDT', 'ADAUSDT', 'GALAUSDT', 'EGLDUSDT', 'SNXUSDT',
    'MANAUSDT', 'ARPAUSDT', 'SEIUSDT', 'ACHUSDT', 'ATOMUSDT'
  ];

  private isTestnet: boolean = true;
  private market: 'spot' | 'futures' = 'spot';
  private wsBase: string;
  private restBase: string;
  private streamSuffix: string;

  private apiKey: string | null = null;
  private apiSecret: string | null = null;

  constructor() {
    this.isTestnet = (process.env.BINANCE_TESTNET ?? 'true') !== 'false';
    this.market = (process.env.BINANCE_MARKET as any) === 'futures' ? 'futures' : 'spot';

    // Autodetect bases
    const autoWs = this.market === 'futures'
      ? (this.isTestnet ? 'wss://stream.binancefuture.com' : 'wss://fstream.binance.com')
      : (this.isTestnet ? 'wss://testnet.binance.vision' : 'wss://stream.binance.com:9443');

    const autoRest = this.market === 'futures'
      ? (this.isTestnet ? 'https://testnet.binancefuture.com' : 'https://fapi.binance.com')
      : (this.isTestnet ? 'https://testnet.binance.vision' : 'https://api.binance.com');

    this.wsBase = process.env.BINANCE_WS_BASE || autoWs;
    this.restBase = process.env.BINANCE_REST_BASE || autoRest;
    this.streamSuffix = process.env.BINANCE_STREAM_SUFFIX
      || (this.market === 'futures' ? 'aggTrade' : 'ticker');
  }
  private get restPrefix(): string {
    return this.market === 'futures' ? '/fapi/v1' : '/api/v3';
  }


  updateCredentials(apiKey: string, apiSecret: string, isTestnet: boolean = true) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.isTestnet = isTestnet;

    // re-evaluate bases when toggling testnet
    const autoWs = this.market === 'futures'
      ? (this.isTestnet ? 'wss://stream.binancefuture.com' : 'wss://fstream.binance.com')
      : (this.isTestnet ? 'wss://testnet.binance.vision' : 'wss://stream.binance.com:9443');

    const autoRest = this.market === 'futures'
      ? (this.isTestnet ? 'https://testnet.binancefuture.com' : 'https://fapi.binance.com')
      : (this.isTestnet ? 'https://testnet.binance.vision' : 'https://api.binance.com');

    this.wsBase = process.env.BINANCE_WS_BASE || autoWs;
    this.restBase = process.env.BINANCE_REST_BASE || autoRest;
  }

  async initializeTradingPairs() {
    try {
      for (const symbol of this.SUPPORTED_PAIRS) {
        const existing = await storage.getTradingPair(symbol);
        if (!existing) {
          const baseAsset = symbol.replace('USDT', '');
          const quoteAsset = 'USDT';
          await db.insert(tradingPairs).values({
            symbol,
            baseAsset,
            quoteAsset,
            isActive: true,
          } as any);
        }
      }
    } catch (error) {
      console.error('Error initializing trading pairs:', error);
    }
  }

  /**
   * Subscribe to ticker or aggTrade for multiple symbols using combined streams.
   */
  startPriceStreams(onUpdate: (data: PriceData) => void) {
    this.SUPPORTED_PAIRS.forEach(symbol => {
      this.startPriceStream(symbol, onUpdate);
    });
  }

  private startPriceStream(symbol: string, onUpdate: (data: PriceData) => void) {
    try {
      const stream = `${symbol.toLowerCase()}@${this.streamSuffix}`;
      // Force combined endpoint form; testnet /ws often 404s
      const url = `${this.wsBase}/stream?streams=${stream}`;
      const ws = new WebSocket(url);

      ws.onopen = () => {
        console.log(`Connected to ${symbol} price stream: ${url}`);
      };

      ws.onmessage = (event) => {
        try {
          const raw = JSON.parse(event.data.toString());
          const data = raw?.data ?? raw; // combined streams wrap payload in {stream, data}
          // Map common fields where present
          if (data?.e === 'aggTrade') {
            const priceData: PriceData = {
              symbol: symbol,
              price: data.p, // price
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

  async getExchangeInfo() {
    try {
      const response = await fetch(`${this.restBase}${this.restPrefix}/exchangeInfo`);
      if (!response.ok) throw new Error(`exchangeInfo HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('Error fetching exchange info:', error);
      return null;
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
      console.error('Error fetching 24hr ticker:', error);
      return null;
    }
  }

  async createOrder(
    symbol: string,
    side: 'LONG' | 'SHORT',
    quantity: number,
    stopLoss?: number,
    takeProfit?: number
  ): Promise<BinanceOrder | null> {
    try {
      if (!this.apiKey || !this.apiSecret) {
        console.error('Binance API credentials not configured');
        return null;
      }
      // TODO: Implement signed order endpoints (HMAC SHA256)
      // For now, disable mock orders and return null to avoid false positives.
      console.warn('createOrder not implemented yet (signed endpoint required)');
      return null;
    } catch (error) {
      console.error('Error creating order:', error);
      return null;
    }
  }

  async cancelOrder(symbol: string, orderId: string): Promise<boolean> {
    try {
      if (!this.apiKey || !this.apiSecret) {
        console.error('Binance API credentials not configured');
        return false;
      }
      console.warn('cancelOrder not implemented yet (signed endpoint required)');
      return false;
    } catch (error) {
      console.error('Error cancelling order:', error);
      return false;
    }
  }

  async getKlines(symbol: string, timeframe: string, limit: number = 500) {
    try {
      const response = await fetch(
        `${this.restBase}${this.restPrefix}/klines?symbol=${symbol}&interval=${timeframe}&limit=${limit}`
      );
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching klines:', error);
      return null;
    }
  }
}
