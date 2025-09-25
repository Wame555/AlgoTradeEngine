import WebSocket from "ws";

import { bulkUpsertCandles, type MarketDataUpsert } from "../db/marketData";
import { BackfillTimeframes } from "./backfill";
import { getLastPrice, setLastPrice, setPrevClose } from "../state/marketCache";
import { CONFIGURED_SYMBOLS } from "../config/symbols";

const WS_BASE_URL = "wss://fstream.binance.com/stream?streams=";
const KEEPALIVE_INTERVAL_MS = 25_000;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;
const FLUSH_INTERVAL_MS = 100;
const MAX_BATCH_SIZE = 500;

const TIMEFRAMES = BackfillTimeframes;

type BinanceCombinedStreamMessage = {
  stream?: string;
  data?: Record<string, any>;
};

type PendingCandle = {
  record: MarketDataUpsert;
  messageId: number;
};

function buildCombinedStreamUrl(symbols: string[]): { url: string; streams: number } {
  const segments: string[] = [];

  for (const symbol of symbols) {
    const lower = symbol.toLowerCase();
    for (const timeframe of TIMEFRAMES) {
      segments.push(`${lower}@kline_${timeframe}`);
    }
    segments.push(`${lower}@aggTrade`);
  }

  return {
    url: `${WS_BASE_URL}${segments.join("/")}`,
    streams: segments.length,
  };
}

export function startLiveFuturesStream(): void {
  const symbols = [...CONFIGURED_SYMBOLS];
  if (symbols.length === 0) {
    console.warn("[live] SYMBOL_LIST is empty. Skipping futures live stream startup.");
    return;
  }

  const { url, streams } = buildCombinedStreamUrl(symbols);
  const symbolCount = symbols.length;
  const timeframeCount = TIMEFRAMES.length;

  let socket: WebSocket | null = null;
  let pingTimer: NodeJS.Timeout | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let reconnectAttempts = 0;
  let hasConnectedOnce = false;
  let messageCounter = 0;
  let flushTimer: NodeJS.Timeout | null = null;
  let flushInProgress = false;

  const pendingCandles: PendingCandle[] = [];

  function cleanupSocket(): void {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }

    if (socket) {
      socket.removeAllListeners();
      socket = null;
    }
  }

  async function flushQueue(): Promise<void> {
    if (flushInProgress) {
      return;
    }
    if (pendingCandles.length === 0) {
      return;
    }

    flushInProgress = true;
    const batch = pendingCandles.splice(0, pendingCandles.length);
    const records = batch.map((item) => item.record);

    try {
      const affected = await bulkUpsertCandles(records);
      if (affected > 0) {
        console.info(`[live] kline-closed upserted ${affected}`);
      }
    } catch (error) {
      const ids = batch.map((item) => item.messageId);
      const minId = Math.min(...ids);
      const maxId = Math.max(...ids);
      const range = minId === maxId ? `#${minId}` : `#${minId}-#${maxId}`;
      console.warn(
        `[live] upsert failed for messages ${range}: ${(error as Error).message ?? error}`,
      );
      pendingCandles.unshift(...batch);
    } finally {
      flushInProgress = false;
      if (pendingCandles.length > 0 && !flushTimer) {
        flushTimer = setTimeout(() => {
          flushTimer = null;
          void flushQueue();
        }, FLUSH_INTERVAL_MS);
      }
    }
  }

  function scheduleFlush(immediate = false): void {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }

    if (immediate) {
      void flushQueue();
      return;
    }

    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushQueue();
    }, FLUSH_INTERVAL_MS);
  }

  function scheduleReconnect(): void {
    if (reconnectTimer) {
      return;
    }

    const delay = Math.min(MAX_BACKOFF_MS, INITIAL_BACKOFF_MS * 2 ** reconnectAttempts);
    const attempt = reconnectAttempts + 1;

    if (delay >= MAX_BACKOFF_MS && reconnectAttempts > 0) {
      console.warn(`[live] ws reconnect delay maxed at ${MAX_BACKOFF_MS}ms (attempt ${attempt})`);
    } else {
      console.warn(`[live] ws reconnecting in ${delay}ms (attempt ${attempt})`);
    }

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      reconnectAttempts += 1;
      connect();
    }, delay);
  }

  function handleKlineMessage(data: Record<string, any>, messageId: number): void {
    try {
      const kline = data.k;
      if (!kline || kline.x !== true) {
        return;
      }

      const symbol = String(data.s ?? "").toUpperCase();
      const timeframe = String(kline.i ?? "");
      const openTime = Number(kline.t ?? 0);
      const open = String(kline.o ?? "0");
      const high = String(kline.h ?? "0");
      const low = String(kline.l ?? "0");
      const close = String(kline.c ?? "0");
      const volume = String(kline.v ?? "0");

      if (!symbol || !timeframe || Number.isNaN(openTime)) {
        return;
      }

      const record: MarketDataUpsert = {
        symbol,
        timeframe,
        ts: new Date(openTime),
        open,
        high,
        low,
        close,
        volume,
      };

      pendingCandles.push({ record, messageId });
      if (pendingCandles.length >= MAX_BATCH_SIZE) {
        scheduleFlush(true);
      } else {
        scheduleFlush(false);
      }

      const closePrice = Number(close);
      if (Number.isFinite(closePrice)) {
        setPrevClose(symbol, timeframe, closePrice);
        if (!Number.isFinite(getLastPrice(symbol) ?? NaN)) {
          setLastPrice(symbol, closePrice);
        }
      }
    } catch (error) {
      console.warn(
        `[live] failed to process kline message #${messageId}: ${(error as Error).message ?? error}`,
      );
    }
  }

  function handleAggTradeMessage(data: Record<string, any>, messageId: number): void {
    try {
      const symbol = String(data.s ?? "").toUpperCase();
      if (!symbol) {
        return;
      }
      const price = Number(data.p ?? "0");
      if (Number.isFinite(price)) {
        setLastPrice(symbol, price);
      }
    } catch (error) {
      console.warn(
        `[live] failed to process aggTrade message #${messageId}: ${(error as Error).message ?? error}`,
      );
    }
  }

  function handleMessage(payload: BinanceCombinedStreamMessage, messageId: number): void {
    const stream = String(payload.stream ?? "");
    const data = payload.data ?? {};

    if (stream.includes("@kline_")) {
      handleKlineMessage(data, messageId);
      return;
    }

    if (stream.endsWith("@aggtrade") || stream.includes("@aggtrade")) {
      handleAggTradeMessage(data, messageId);
    }
  }

  function connect(): void {
    cleanupSocket();

    socket = new WebSocket(url);

    socket.on("open", () => {
      reconnectAttempts = 0;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      if (pingTimer) {
        clearInterval(pingTimer);
      }
      pingTimer = setInterval(() => {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.ping();
        }
      }, KEEPALIVE_INTERVAL_MS);

      if (hasConnectedOnce) {
        console.info(
          `[live] ws reconnected (symbols=${symbolCount}, timeframes=${timeframeCount}, streams=${streams})`,
        );
      } else {
        hasConnectedOnce = true;
        console.info(
          `[live] ws connected (symbols=${symbolCount}, timeframes=${timeframeCount}, streams=${streams})`,
        );
      }
    });

    socket.on("message", (raw: WebSocket.RawData) => {
      messageCounter += 1;
      try {
        const payload = JSON.parse(raw.toString()) as BinanceCombinedStreamMessage;
        handleMessage(payload, messageCounter);
      } catch (error) {
        console.warn(
          `[live] failed to parse message #${messageCounter}: ${(error as Error).message ?? error}`,
        );
      }
    });

    socket.on("close", () => {
      cleanupSocket();
      scheduleReconnect();
    });

    socket.on("error", (err) => {
      console.warn(`[live] ws error: ${(err as Error).message ?? err}`);
      if (socket && socket.readyState !== WebSocket.CLOSING && socket.readyState !== WebSocket.CLOSED) {
        socket.terminate();
      }
    });
  }

  connect();
}
