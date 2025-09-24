import { useQuery } from '@tanstack/react-query';
import { TradingPair, Position, Signal, MarketData, IndicatorConfig, UserSettings } from '@/types/trading';

const MOCK_USER_ID = 'mock-user-123';

export function useTradingPairs() {
  return useQuery<TradingPair[]>({
    queryKey: ['/api/pairs'],
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useMarketData(symbols?: string[]) {
  const queryKey = symbols ? ['/api/market-data', { symbols: symbols.join(',') }] : ['/api/market-data'];
  
  return useQuery<MarketData[]>({
    queryKey,
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 30 * 1000,
  });
}

export function usePositions() {
  return useQuery<Position[]>({
    queryKey: ['/api/positions', MOCK_USER_ID],
    staleTime: 10 * 1000, // 10 seconds
    refetchInterval: 10 * 1000,
  });
}

export function useSignals(limit?: number) {
  return useQuery<Signal[]>({
    queryKey: ['/api/signals', { limit }],
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 30 * 1000,
  });
}

export function useSignalsBySymbol(symbol: string, limit?: number) {
  return useQuery<Signal[]>({
    queryKey: ['/api/signals', symbol, { limit }],
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
  });
}

export function useIndicators() {
  return useQuery<IndicatorConfig[]>({
    queryKey: ['/api/indicators', MOCK_USER_ID],
    staleTime: 60 * 1000, // 1 minute
  });
}

export function useUserSettings() {
  return useQuery<UserSettings>({
    queryKey: ['/api/settings', MOCK_USER_ID],
    staleTime: 60 * 1000,
  });
}

export function usePairTimeframes() {
  return useQuery({
    queryKey: ['/api/pair-timeframes', MOCK_USER_ID],
    staleTime: 60 * 1000,
  });
}
