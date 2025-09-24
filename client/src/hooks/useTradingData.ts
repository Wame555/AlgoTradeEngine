import { useQuery } from '@tanstack/react-query';
import {
  TradingPair,
  Position,
  Signal,
  MarketData,
  IndicatorConfig,
  UserSettings,
  PairTimeframe,
  AccountSnapshot,
  PositionStats,
} from '@/types/trading';
import { useSession, useUserId } from '@/hooks/useSession';

export function useTradingPairs() {
  return useQuery<TradingPair[]>({
    queryKey: ['/api/pairs'],
    staleTime: 5 * 60 * 1000,
  });
}

export function useMarketData(symbols?: string[]) {
  const queryKey = symbols && symbols.length > 0
    ? ['/api/market-data', { symbols: symbols.join(',') }]
    : ['/api/market-data'];

  return useQuery<MarketData[]>({
    queryKey,
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
  });
}

export function useAccount() {
  return useQuery<AccountSnapshot>({
    queryKey: ['/api/account'],
    staleTime: 5 * 1000,
    refetchInterval: 5 * 1000,
  });
}

export function usePositions() {
  const userId = useUserId();

  return useQuery<Position[]>({
    queryKey: ['/api/positions', userId],
    staleTime: 10 * 1000,
    refetchInterval: 10 * 1000,
    enabled: Boolean(userId),
  });
}

export function usePositionStats() {
  const userId = useUserId();

  return useQuery<PositionStats>({
    queryKey: ['/api/positions', userId, 'stats'],
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
    enabled: Boolean(userId),
  });
}

export function useSignals(limit?: number) {
  const userId = useUserId();

  return useQuery<Signal[]>({
    queryKey: ['/api/signals', { limit, userId }],
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
    enabled: Boolean(userId),
  });
}

export function useSignalsBySymbol(symbol: string, limit?: number) {
  const userId = useUserId();

  return useQuery<Signal[]>({
    queryKey: ['/api/signals', symbol, { limit, userId }],
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
    enabled: Boolean(userId && symbol),
  });
}

export function useIndicators() {
  const userId = useUserId();

  return useQuery<IndicatorConfig[]>({
    queryKey: ['/api/indicators', userId],
    staleTime: 60 * 1000,
    enabled: Boolean(userId),
  });
}

export function useUserSettings() {
  const userId = useUserId();

  return useQuery<UserSettings>({
    queryKey: ['/api/settings', userId],
    staleTime: 60 * 1000,
    enabled: Boolean(userId),
  });
}

export function usePairTimeframes() {
  const userId = useUserId();

  return useQuery<PairTimeframe[]>({
    queryKey: ['/api/pair-timeframes', userId],
    staleTime: 60 * 1000,
    enabled: Boolean(userId),
  });
}

export function useSessionSettings() {
  const { session } = useSession();
  return session?.settings ?? null;
}
