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

export function getHealthSnapshot(): { ws: boolean; cache: boolean; wsStatus: WsStatus; lastWsEvent: number; symbols: boolean } {
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
}
