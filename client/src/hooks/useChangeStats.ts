import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ChangeStats, Timeframe } from '@/types/trading';

const DEFAULT_VALUES = {
  prevClose: 0,
  lastPrice: 0,
  changePct: 0,
  pnlUsdForOpenPositionsBySymbol: 0,
} as const;

export function useChangeStats(symbol: string | undefined, timeframe: Timeframe) {
  const queryKey = useMemo(() => ['/api/stats/change', { symbol, timeframe }], [symbol, timeframe]);

  return useQuery<ChangeStats>({
    queryKey,
    enabled: Boolean(symbol && timeframe),
    staleTime: 1000,
    refetchInterval: 1000,
    queryFn: async () => {
      const base: ChangeStats = {
        symbol: symbol ?? '',
        timeframe,
        ...DEFAULT_VALUES,
      };

      if (!symbol) {
        return base;
      }

      try {
        const url = `/api/stats/change?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`;
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) {
          return base;
        }
        const data = (await response.json()) as ChangeStats;
        return {
          ...base,
          ...data,
        };
      } catch (error) {
        return base;
      }
    },
    placeholderData: () => ({
      symbol: symbol ?? '',
      timeframe,
      ...DEFAULT_VALUES,
    }),
  });
}
