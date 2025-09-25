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
}
