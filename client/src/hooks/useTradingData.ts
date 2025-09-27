import { useQuery } from '@tanstack/react-query';
import {
  TradingPair,
  ClosedPositionSummary,
  Signal,
  MarketData,
  IndicatorConfig,
  UserSettings,
  AccountSnapshot,
  StatsSummary,
  Market24hChange,
  Market24hChangeResult,
} from '@/types/trading';
import { useSession, useUserId } from '@/hooks/useSession';
import { useOpenPositions } from '@/hooks/useOpenPositions';

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
  return useOpenPositions();
}

export function useClosedPositions(symbol?: string, limit: number = 50, offset: number = 0) {
  const userId = useUserId();

  return useQuery<ClosedPositionSummary[]>({
    queryKey: ['/api/positions/closed', { userId, symbol, limit, offset }],
    enabled: Boolean(userId),
  });
}

export function useStatsSummary() {
  const defaultSummary: StatsSummary = {
    totalTrades: 0,
    winRate: 0,
    avgRR: 0,
    totalPnl: 0,
    dailyPnl: 0,
    last30dPnl: 0,
    balance: 0,
    equity: 0,
    openPnL: 0,
    totalBalance: 0,
    initialBalance: 0,
  };

  return useQuery<StatsSummary>({
    queryKey: ['/api/stats/summary'],
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    placeholderData: () => defaultSummary,
    initialData: defaultSummary,
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
    queryKey: ['/api/indicators/configs', { userId }],
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

export function usePairTimeframes(symbol?: string) {
  return useQuery<string[]>({
    queryKey: ['/api/pairs', symbol ?? '', 'settings'],
    staleTime: 60 * 1000,
    enabled: Boolean(symbol),
    select: (result: any) => {
      if (!result || !Array.isArray(result.activeTimeframes)) {
        return [];
      }
      return result.activeTimeframes.filter((value: unknown) => typeof value === 'string') as string[];
    },
  });
}

export function useMarket24hChange(symbols?: string[]) {
  const shouldFetchAll = symbols == null;
  const cleanedSymbols = (symbols ?? [])
    .map((symbol) => symbol?.toUpperCase() ?? '')
    .filter((symbol) => symbol.length > 0);
  const uniqueSymbols = Array.from(new Set(cleanedSymbols));

  const queryKey = shouldFetchAll
    ? ['/api/market/24h']
    : ['/api/market/24h', { symbols: uniqueSymbols.join(',') }];

  return useQuery<Market24hChangeResult, unknown, Map<string, Market24hChange>>({
    queryKey,
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
    enabled: shouldFetchAll || uniqueSymbols.length > 0,
    select: (response) => {
      const items = Array.isArray(response?.items) ? response.items : [];
      const map = new Map<string, Market24hChange>();
      for (const item of items) {
        if (!item?.symbol) {
          continue;
        }
        map.set(item.symbol, item);
      }
      return map;
    },
  });
}

export function useSessionSettings() {
  const { session } = useSession();
  return session?.settings ?? null;
}
