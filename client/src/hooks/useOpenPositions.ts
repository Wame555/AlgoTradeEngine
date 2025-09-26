import { useQuery } from '@tanstack/react-query';
import { TIMEFRAMES } from '@/constants/timeframes';
import type { Position, Timeframe } from '@/types/trading';
import type { SupportedTimeframe } from '@shared/types';
import { useUserId } from '@/hooks/useSession';

function createDefaultTimeframeRecord(): Record<Timeframe, number> {
  return TIMEFRAMES.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {} as Record<Timeframe, number>);
}

function createDefaultFlagRecord(): Record<Timeframe, boolean> {
  return TIMEFRAMES.reduce((acc, key) => {
    acc[key] = false;
    return acc;
  }, {} as Record<Timeframe, boolean>);
}

function normalizeTimeframeRecord(record: Record<string, number> | undefined): Record<Timeframe, number> {
  const base = createDefaultTimeframeRecord();
  if (!record) {
    return base;
  }

  for (const key of TIMEFRAMES) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      base[key] = value;
    }
  }

  return base;
}

function normalizeFlagRecord(record: Record<string, boolean> | undefined): Record<Timeframe, boolean> {
  const base = createDefaultFlagRecord();
  if (!record) {
    return base;
  }

  for (const key of TIMEFRAMES) {
    const value = record[key];
    if (typeof value === 'boolean') {
      base[key] = value;
    }
  }

  return base;
}

export function useOpenPositions() {
  const userId = useUserId();

  return useQuery<Position[]>({
    queryKey: ['/api/positions/open', { userId }],
    enabled: Boolean(userId),
    staleTime: 5000,
    refetchInterval: 5000,
    select: (data) =>
      (data ?? []).map((position) => ({
        ...position,
        changePctByTimeframe: normalizeTimeframeRecord(
          position.changePctByTimeframe as unknown as Record<string, number> | undefined,
        ) as unknown as Record<SupportedTimeframe, number>,
        pnlByTimeframe: normalizeTimeframeRecord(
          position.pnlByTimeframe as unknown as Record<string, number> | undefined,
        ) as unknown as Record<SupportedTimeframe, number>,
        partialData: position.partialData ?? false,
        partialDataByTimeframe: normalizeFlagRecord(
          position.partialDataByTimeframe as unknown as Record<string, boolean> | undefined,
        ) as unknown as Record<SupportedTimeframe, boolean>,
      })),
  });
}
