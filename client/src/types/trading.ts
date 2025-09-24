export interface TradingPair {
  id: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  isActive: boolean;
  minNotional?: string;
  stepSize?: string;
  tickSize?: string;
}

export interface Position {
  id: string;
  userId: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  size: string;
  entryPrice: string;
  currentPrice?: string;
  pnl?: string;
  stopLoss?: string;
  takeProfit?: string;
  trailingStopPercent?: number;
  status: string;
  orderId?: string;
  openedAt: string;
  closedAt?: string;
}

export interface Signal {
  id: string;
  symbol: string;
  timeframe: string;
  signal: 'LONG' | 'SHORT' | 'WAIT';
  confidence: number;
  indicators: any;
  price: string;
  createdAt: string;
}

export interface MarketData {
  id: string;
  symbol: string;
  timeframe: string;
  price: string;
  volume?: string;
  change24h?: number;
  high24h?: string;
  low24h?: string;
  updatedAt: string;
}

export interface IndicatorConfig {
  id: string;
  userId: string;
  name: string;
  type: string;
  parameters: any;
  weight: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserSettings {
  id: string;
  userId: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  binanceApiKey?: string;
  binanceApiSecret?: string;
  isTestnet: boolean;
  defaultLeverage: number;
  riskPercent: number;
  createdAt: string;
  updatedAt: string;
}

export interface PriceUpdate {
  symbol: string;
  price: string;
  change24h: string;
  volume24h: string;
  high24h: string;
  low24h: string;
}

export interface WebSocketMessage {
  type: string;
  data?: any;
  userId?: string;
}

export const SUPPORTED_TIMEFRAMES = ['1m', '3m', '5m', '15m', '1h', '4h', '1d', '1w'];
export const SUPPORTED_PAIRS = [
  'ETHUSDT', 'BTCUSDT', 'AVAXUSDT', 'SOLUSDT', 'DOTUSDT', 
  'ENJUSDT', 'ADAUSDT', 'GALAUSDT', 'EGLDUSDT', 'SNXUSDT', 
  'MANAUSDT', 'ARPAUSDT', 'SEIUSDT', 'ACHUSDT', 'ATOMUSDT'
];
