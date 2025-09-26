type WsStatus = 'disconnected' | 'connecting' | 'connected' | 'disabled';

interface HealthState {
  wsStatus: WsStatus;
  cacheReady: boolean;
  lastWsEvent: number;
  symbolsConfigured: boolean;
}

const state: HealthState = {
  wsStatus: 'connecting',
  cacheReady: false,
  lastWsEvent: Date.now(),
  symbolsConfigured: false,
};

interface BackfillEntry {
  done: number;
  target: number;
}

const backfillProgress = new Map<string, BackfillEntry>();

export function markCacheReady(ready: boolean): void {
  state.cacheReady = ready;
}

export function markWsStatus(status: WsStatus): void {
  state.wsStatus = status;
  state.lastWsEvent = Date.now();
}

export function markSymbolsConfigured(configured: boolean): void {
  state.symbolsConfigured = configured;
}

export function setBackfillTarget(timeframe: string, target: number): void {
  const existing = backfillProgress.get(timeframe) ?? { done: 0, target: 0 };
  backfillProgress.set(timeframe, {
    done: Math.max(0, existing.done),
    target: Number.isFinite(target) && target > 0 ? target : 0,
  });
}

export function incrementBackfillProgress(timeframe: string, delta: number): void {
  const existing = backfillProgress.get(timeframe) ?? { done: 0, target: 0 };
  const updated = Math.max(0, existing.done + (Number.isFinite(delta) ? delta : 0));
  backfillProgress.set(timeframe, { done: updated, target: existing.target });
}

export function getBackfillSnapshot(): Record<string, BackfillEntry> {
  const snapshot: Record<string, BackfillEntry> = {};
  for (const [timeframe, entry] of backfillProgress.entries()) {
    snapshot[timeframe] = { done: entry.done, target: entry.target };
  }
  return snapshot;
}

export function resetBackfillProgress(): void {
  backfillProgress.clear();
}

export function getHealthSnapshot(): {
  ws: boolean;
  cache: boolean;
  wsStatus: WsStatus;
  lastWsEvent: number;
  symbols: boolean;
} {
  const wsHealthy = state.wsStatus === 'connected' || state.wsStatus === 'disabled';
  return {
    ws: wsHealthy,
    cache: state.cacheReady,
    wsStatus: state.wsStatus,
    lastWsEvent: state.lastWsEvent,
    symbols: state.symbolsConfigured,
  };
}

export function resetHealthState(): void {
  state.wsStatus = 'connecting';
  state.cacheReady = false;
  state.lastWsEvent = Date.now();
  state.symbolsConfigured = false;
  resetBackfillProgress();
}
