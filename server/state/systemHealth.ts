type WsStatus = 'disconnected' | 'connecting' | 'connected' | 'disabled';

interface HealthState {
  wsStatus: WsStatus;
  cacheReady: boolean;
  lastWsEvent: number;
}

const state: HealthState = {
  wsStatus: 'connecting',
  cacheReady: false,
  lastWsEvent: Date.now(),
};

export function markCacheReady(ready: boolean): void {
  state.cacheReady = ready;
}

export function markWsStatus(status: WsStatus): void {
  state.wsStatus = status;
  state.lastWsEvent = Date.now();
}

export function getHealthSnapshot(): { ws: boolean; cache: boolean; wsStatus: WsStatus; lastWsEvent: number } {
  const wsHealthy = state.wsStatus === 'connected' || state.wsStatus === 'disabled';
  return {
    ws: wsHealthy,
    cache: state.cacheReady,
    wsStatus: state.wsStatus,
    lastWsEvent: state.lastWsEvent,
  };
}

export function resetHealthState(): void {
  state.wsStatus = 'connecting';
  state.cacheReady = false;
  state.lastWsEvent = Date.now();
}
