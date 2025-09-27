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

export interface PairTimeframeSettingsResponse {
  symbol: string;
  activeTimeframes: SupportedTimeframe[];
}

export interface OpenPositionResponse {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  sizeUsd: string;
  qty: string;
  entryPrice: string;
  currentPrice?: string;
  pnlUsd: string;
  amountUsd?: string | null;
  leverage?: string | null;
  tpPrice?: string | null;
  slPrice?: string | null;
  status: string;
  openedAt: string;
  closedAt?: string;
  userId?: string;
  orderId?: string;
}

export interface StatsSummaryResponse {
  totalTrades: number;
  winRate: number;
  avgRR: number;
  totalPnl: number;
  dailyPnl: number;
  last30dPnl: number;
  balance: number;
  equity: number;
  openPnL: number;
  totalBalance?: number;
}
