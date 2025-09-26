export const SUPPORTED_TIMEFRAMES = [
  "1m",
  "3m",
  "5m",
  "15m",
  "1h",
  "4h",
  "1d",
  "1w",
  "1M",
  "1y",
] as const;

export type SupportedTimeframe = (typeof SUPPORTED_TIMEFRAMES)[number];

export interface StatsChangeResponse {
  symbol: string;
  timeframe: SupportedTimeframe;
  prevClose: number;
  lastPrice: number;
  changePct: number;
  pnlUsdForOpenPositionsBySymbol: number;
  partialData?: boolean;
}

export interface OpenPositionResponse {
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
  changePctByTimeframe: Record<SupportedTimeframe, number>;
  pnlByTimeframe: Record<SupportedTimeframe, number>;
  partialData?: boolean;
  partialDataByTimeframe?: Record<SupportedTimeframe, boolean>;
}

export interface StatsSummaryResponse {
  totalTrades: number;
  winRate: number;
  avgRR: number;
  totalPnl: number;
  last30dPnl: number;
  balance: number;
  equity: number;
  openPnL: number;
}
