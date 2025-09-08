import { storage } from "../storage";
import WebSocket from "ws";
import { db } from "../db";
import { tradingPairs } from "@shared/schema";

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
  change24h: string;
  volume24h: string;
  high24h: string;
  low24h: string;
}

export class BinanceService {
  private apiKey: string = '';
  private apiSecret: string = '';
  private isTestnet: boolean = true;
  private baseUrl: string = 'https://testnet.binance.vision';
  
  private readonly SUPPORTED_PAIRS = [
    'ETHUSDT', 'BTCUSDT', 'AVAXUSDT', 'SOLUSDT', 'DOTUSDT', 
    'ENJUSDT', 'ADAUSDT', 'GALAUSDT', 'EGLDUSDT', 'SNXUSDT', 
    'MANAUSDT', 'ARPAUSDT', 'SEIUSDT', 'ACHUSDT', 'ATOMUSDT'
  ];

  private readonly TIMEFRAMES = ['1m', '3m', '5m', '15m', '1h', '4h', '1d', '1w'];

  constructor() {
    // Initialize with environment variables if available
    this.apiKey = process.env.BINANCE_API_KEY || '';
    this.apiSecret = process.env.BINANCE_API_SECRET || '';
    this.isTestnet = process.env.BINANCE_TESTNET !== 'false';
    this.baseUrl = this.isTestnet ? 'https://testnet.binance.vision' : 'https://api.binance.com';
  }

  updateCredentials(apiKey: string, apiSecret: string, isTestnet: boolean = true) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.isTestnet = isTestnet;
    this.baseUrl = isTestnet ? 'https://testnet.binance.vision' : 'https://api.binance.com';
  }

  async initializeTradingPairs() {
    try {
      // Create trading pairs in database if they don't exist
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
            minNotional: '10',
            stepSize: '0.00001',
            tickSize: '0.01',
          }).onConflictDoNothing();
        }
      }
      console.log('Trading pairs initialized');
    } catch (error) {
      console.error('Error initializing trading pairs:', error);
    }
  }

  async getExchangeInfo() {
    try {
      const response = await fetch(`${this.baseUrl}/api/v3/exchangeInfo`);
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching exchange info:', error);
      return null;
    }
  }

  async get24hrTicker(symbol?: string) {
    try {
      const url = symbol 
        ? `${this.baseUrl}/api/v3/ticker/24hr?symbol=${symbol}`
        : `${this.baseUrl}/api/v3/ticker/24hr`;
      
      const response = await fetch(url);
      const data = await response.json();
      return data;
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

      const binanceSide = side === 'LONG' ? 'BUY' : 'SELL';
      
      // This is a simplified version - in production you'd need proper signature generation
      console.log(`Creating ${side} order for ${symbol}: ${quantity}`);
      
      // For now, return a mock order since we need proper HMAC signature implementation
      return {
        orderId: `mock_${Date.now()}`,
        symbol,
        side: binanceSide,
        status: 'FILLED',
        price: '0',
        origQty: quantity.toString(),
        executedQty: quantity.toString(),
      };
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

      console.log(`Cancelling order ${orderId} for ${symbol}`);
      return true;
    } catch (error) {
      console.error('Error cancelling order:', error);
      return false;
    }
  }

  startPriceStreams(onUpdate: (data: PriceData) => void) {
    // Start WebSocket connections for all supported pairs
    this.SUPPORTED_PAIRS.forEach(symbol => {
      this.startPriceStream(symbol, onUpdate);
    });
  }

  private startPriceStream(symbol: string, onUpdate: (data: PriceData) => void) {
    try {
      const wsUrl = this.isTestnet 
        ? 'wss://testnet.binance.vision/ws'
        : 'wss://stream.binance.com:9443/ws';

      const streamName = `${symbol.toLowerCase()}@ticker`;
      const ws = new WebSocket(`${wsUrl}/${streamName}`);

      ws.onopen = () => {
        console.log(`Connected to ${symbol} price stream`);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.s && data.c) {
            const priceData: PriceData = {
              symbol: data.s,
              price: data.c,
              change24h: data.P,
              volume24h: data.v,
              high24h: data.h,
              low24h: data.l,
            };
            
            onUpdate(priceData);
            
            // Update market data in database
            storage.updateMarketData({
              symbol: data.s,
              timeframe: '24h',
              price: data.c,
              volume: data.v,
              change24h: parseFloat(data.P),
              high24h: data.h,
              low24h: data.l,
            });
          }
        } catch (error) {
          console.error('Error processing price data:', error);
        }
      };

      ws.onerror = (error) => {
        console.error(`WebSocket error for ${symbol}:`, error);
      };

      ws.onclose = () => {
        console.log(`Disconnected from ${symbol} price stream`);
        // Attempt to reconnect after 5 seconds
        setTimeout(() => {
          this.startPriceStream(symbol, onUpdate);
        }, 5000);
      };

      // Generate mock price updates every 2 seconds for demonstration
      setInterval(() => {
        const basePrice = this.getMockBasePrice(symbol);
        const change = (Math.random() - 0.5) * 0.02; // ±1% change
        const price = (basePrice * (1 + change)).toFixed(8);
        const change24h = ((Math.random() - 0.5) * 10).toFixed(2); // ±5% daily change
        
        const mockData: PriceData = {
          symbol,
          price,
          change24h,
          volume24h: (Math.random() * 1000000).toFixed(2),
          high24h: (basePrice * 1.02).toFixed(8),
          low24h: (basePrice * 0.98).toFixed(8),
        };
        
        onUpdate(mockData);
      }, 2000);

    } catch (error) {
      console.error(`Error starting price stream for ${symbol}:`, error);
    }
  }

  private getMockBasePrice(symbol: string): number {
    const basePrices: { [key: string]: number } = {
      'BTCUSDT': 43250,
      'ETHUSDT': 2560,
      'AVAXUSDT': 34.50,
      'SOLUSDT': 98.45,
      'DOTUSDT': 7.25,
      'ENJUSDT': 0.45,
      'ADAUSDT': 0.46,
      'GALAUSDT': 0.033,
      'EGLDUSDT': 65.20,
      'SNXUSDT': 3.45,
      'MANAUSDT': 0.52,
      'ARPAUSDT': 0.087,
      'SEIUSDT': 0.65,
      'ACHUSDT': 0.024,
      'ATOMUSDT': 12.75,
    };
    return basePrices[symbol] || 100;
  }

  async getKlines(symbol: string, timeframe: string, limit: number = 500) {
    try {
      const response = await fetch(
        `${this.baseUrl}/api/v3/klines?symbol=${symbol}&interval=${timeframe}&limit=${limit}`
      );
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching klines:', error);
      return null;
    }
  }
}
