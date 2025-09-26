import type { OpenPositionResponse, StatsChangeResponse, SupportedTimeframe } from '@shared/types';
import { SUPPORTED_TIMEFRAMES as SHARED_SUPPORTED_TIMEFRAMES } from '@shared/types';
import { TIMEFRAMES } from '@/constants/timeframes';

export interface TradingPair {
  id: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  isActive: boolean;
  minNotional?: string | null;
  minQty?: string | null;
  stepSize?: string | null;
  tickSize?: string | null;
}

export interface PairTimeframe {
  id: string;
  symbol: string;
  timeframe: string;
  createdAt: string;
}

export type Position = OpenPositionResponse;

export interface ClosedPositionSummary {
  id: string;
  userId: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  size: string;
  entryPrice: string;
  exitPrice: string;
  feeUsd: string;
  pnlUsd: string;
  pnlPct: number;
  openedAt: string;
  closedAt: string;
}

export interface Signal {
  id: string;
  symbol: string;
  timeframe: string;
  signal: 'LONG' | 'SHORT' | 'WAIT';
  confidence: number;
  indicators: Record<string, IndicatorBreakdown>;
  price: string;
  createdAt: string;
}

export interface IndicatorBreakdown {
  value: number;
  signal: 'LONG' | 'SHORT' | 'WAIT';
  confidence: number;
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
  name: string;
  payload: Record<string, unknown>;
  createdAt: string;
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
  demoEnabled: boolean;
  defaultTpPct: string;
  defaultSlPct: string;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  username: string;
  createdAt: string;
}

export interface SessionData {
  userId: string;
  demo: boolean;
  settings?: UserSettings | null;
  serverTime?: string;
}

export interface AccountSnapshot {
  balance: number;
  equity: number;
  marginUsed: number;
}

export interface StatsSummary {
  totalTrades: number;
  winRate: number;
  avgRR: number;
  totalPnl: number;
  last30dPnl: number;
}

export type StatsChange = StatsChangeResponse;

export type Timeframe = (typeof TIMEFRAMES)[number];

export interface ChangeStats {
  symbol: string;
  timeframe: Timeframe;
  prevClose: number;
  lastPrice: number;
  changePct: number;
  pnlUsdForOpenPositionsBySymbol: number;
  partialData?: boolean;
}

export interface PriceUpdate {
  symbol: string;
  price: string;
  change24h?: string;
  volume24h?: string;
  high24h?: string;
  low24h?: string;
}

export interface WebSocketMessage {
  type: string;
  data?: any;
  userId?: string;
}

export type { SupportedTimeframe };

export const SUPPORTED_TIMEFRAMES = SHARED_SUPPORTED_TIMEFRAMES;
