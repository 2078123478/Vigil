import type { Quote } from "../types";
import { OnchainOsClient } from "./onchainos-client";
import { StateStore } from "./state-store";

const DEFAULT_QUOTE_STALE_MS = 1000;
const DEFAULT_WS_RECONNECT_MS = 2000;
const DEFAULT_WS_HEARTBEAT_MS = 15000;
const DEFAULT_ANOMALY_DEVIATION_PCT = 0.05;
const DEFAULT_ANOMALY_STREAK_ALERT = 3;

interface WsEventLike {
  data?: unknown;
}

export interface WsSocketLike {
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: WsEventLike) => void) | null;
  onerror: (() => void) | null;
  onclose: ((event?: { code?: number; reason?: string }) => void) | null;
  send(data: string): void;
  close(): void;
}

type WsFactory = (url: string) => WsSocketLike | null;

export interface WsMarketWatchOptions {
  wsUrl: string;
  reconnectMs?: number;
  heartbeatMs?: number;
  createSocket?: WsFactory;
  onQuote: (quote: Quote) => void;
  onAlert: (eventType: string, message: string) => void;
}

export interface MarketWatchOptions {
  wsEnabled?: boolean;
  wsUrl?: string;
  wsReconnectMs?: number;
  wsHeartbeatMs?: number;
  quoteStaleMs?: number;
  anomalyDeviationPct?: number;
  anomalyStreakAlertThreshold?: number;
  wsFactory?: WsFactory;
}

function defaultWsFactory(url: string): WsSocketLike | null {
  const wsCtor = (globalThis as { WebSocket?: new (endpoint: string) => WsSocketLike }).WebSocket;
  if (!wsCtor) {
    return null;
  }
  return new wsCtor(url);
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function parseQuote(payload: unknown): Quote | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const input = payload as Record<string, unknown>;
  if (
    typeof input.pair !== "string" ||
    typeof input.dex !== "string" ||
    typeof input.ts !== "string"
  ) {
    return null;
  }
  const bid = Number(input.bid);
  const ask = Number(input.ask);
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) {
    return null;
  }
  const gasUsd = Number(input.gasUsd);
  return {
    pair: input.pair,
    dex: input.dex,
    bid,
    ask,
    gasUsd: Number.isFinite(gasUsd) ? gasUsd : 0,
    ts: input.ts,
  };
}

export class WsMarketWatch {
  private socket: WsSocketLike | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private readonly subscriptions = new Map<string, Set<string>>();
  private running = false;

  constructor(private readonly options: WsMarketWatchOptions) {}

  subscribe(pair: string, dexes: string[]): void {
    const existing = this.subscriptions.get(pair) ?? new Set<string>();
    for (const dex of dexes) {
      existing.add(dex);
    }
    this.subscriptions.set(pair, existing);
    this.ensureConnected();
    this.send({
      type: "subscribe",
      pair,
      dexes: [...existing],
    });
  }

  unsubscribe(pair: string, dexes?: string[]): void {
    const existing = this.subscriptions.get(pair);
    if (!existing) {
      return;
    }

    if (!dexes || dexes.length === 0) {
      this.subscriptions.delete(pair);
      this.send({ type: "unsubscribe", pair });
      return;
    }

    for (const dex of dexes) {
      existing.delete(dex);
    }
    if (existing.size === 0) {
      this.subscriptions.delete(pair);
      this.send({ type: "unsubscribe", pair });
      return;
    }
    this.send({
      type: "subscribe",
      pair,
      dexes: [...existing],
    });
  }

  close(): void {
    this.running = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onerror = null;
      this.socket.onclose = null;
      this.socket.close();
      this.socket = null;
    }
  }

  isConnected(): boolean {
    return this.socket?.readyState === 1;
  }

  private ensureConnected(): void {
    if (this.running || this.socket) {
      return;
    }
    this.running = true;
    this.openSocket();
  }

  private openSocket(): void {
    const wsFactory = this.options.createSocket ?? defaultWsFactory;
    const socket = wsFactory(this.options.wsUrl);
    if (!socket) {
      this.options.onAlert("market_ws_unavailable", "WebSocket unavailable, fallback to polling");
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;
    socket.onopen = () => {
      this.flushSubscriptions();
      this.startHeartbeat();
    };
    socket.onmessage = (event) => {
      this.handleMessage(event.data);
    };
    socket.onerror = () => {
      this.options.onAlert("market_ws_error", "WebSocket stream error");
    };
    socket.onclose = () => {
      this.stopHeartbeat();
      this.socket = null;
      if (this.running) {
        this.options.onAlert("market_ws_reconnect", "WebSocket disconnected, scheduling reconnect");
        this.scheduleReconnect();
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.running) {
      return;
    }
    const reconnectMs = Math.max(100, this.options.reconnectMs ?? DEFAULT_WS_RECONNECT_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.running) {
        return;
      }
      this.openSocket();
    }, reconnectMs);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const heartbeatMs = Math.max(1000, this.options.heartbeatMs ?? DEFAULT_WS_HEARTBEAT_MS);
    this.heartbeatTimer = setInterval(() => {
      this.send({
        type: "ping",
        ts: new Date().toISOString(),
      });
    }, heartbeatMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private flushSubscriptions(): void {
    for (const [pair, dexes] of this.subscriptions.entries()) {
      this.send({
        type: "subscribe",
        pair,
        dexes: [...dexes],
      });
    }
  }

  private send(payload: Record<string, unknown>): void {
    if (!this.socket || this.socket.readyState !== 1) {
      return;
    }
    try {
      this.socket.send(JSON.stringify(payload));
    } catch (error) {
      this.options.onAlert("market_ws_send_failure", String(error));
    }
  }

  private handleMessage(raw: unknown): void {
    let parsed: unknown = raw;
    if (typeof raw === "string") {
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        this.options.onAlert("market_ws_parse_error", "Failed to parse WebSocket payload");
        return;
      }
    }

    if (!parsed || typeof parsed !== "object") {
      return;
    }

    const root = parsed as Record<string, unknown>;
    const candidates = Array.isArray(root.quotes)
      ? root.quotes
      : root.quote
        ? [root.quote]
        : root.type === "quote"
          ? [root]
          : [];

    for (const candidate of candidates) {
      const quote = parseQuote(candidate);
      if (quote) {
        this.options.onQuote(quote);
      }
    }
  }
}

export class MarketWatch {
  private readonly quoteStaleMs: number;
  private readonly anomalyDeviationPct: number;
  private readonly anomalyStreakAlertThreshold: number;
  private readonly ws: WsMarketWatch | null;
  private readonly latestByPairDex = new Map<string, Quote>();
  private readonly lastTsByPairDex = new Map<string, number>();
  private anomalyStreak = 0;

  constructor(
    private readonly client: OnchainOsClient,
    private readonly store: StateStore,
    options: MarketWatchOptions = {},
  ) {
    this.quoteStaleMs = Math.max(1, Math.floor(options.quoteStaleMs ?? DEFAULT_QUOTE_STALE_MS));
    this.anomalyDeviationPct = Math.max(
      0.01,
      Math.min(0.5, options.anomalyDeviationPct ?? DEFAULT_ANOMALY_DEVIATION_PCT),
    );
    this.anomalyStreakAlertThreshold = Math.max(
      1,
      Math.floor(options.anomalyStreakAlertThreshold ?? DEFAULT_ANOMALY_STREAK_ALERT),
    );

    this.ws =
      options.wsEnabled && options.wsUrl
        ? new WsMarketWatch({
            wsUrl: options.wsUrl,
            reconnectMs: options.wsReconnectMs,
            heartbeatMs: options.wsHeartbeatMs,
            createSocket: options.wsFactory,
            onQuote: (quote) => {
              this.processQuotes([quote], "ws");
            },
            onAlert: (eventType, message) => {
              this.store.insertAlert("warn", eventType, message);
            },
          })
        : null;
  }

  async fetch(pair: string, dexes: string[]): Promise<Quote[]> {
    if (this.ws) {
      this.ws.subscribe(pair, dexes);
      const wsQuotes = this.getLatestQuotes(pair, dexes).filter((quote) => this.isFresh(quote));
      if (wsQuotes.length > 0) {
        return wsQuotes;
      }
    }

    const quotes = await this.client.getQuotes(pair, dexes);
    return this.processQuotes(quotes, "poll");
  }

  close(): void {
    this.ws?.close();
  }

  private processQuotes(quotes: Quote[], source: "poll" | "ws"): Quote[] {
    if (quotes.length === 0) {
      return [];
    }

    const medians = this.buildPairMedians(quotes);
    const accepted: Quote[] = [];
    for (const quote of quotes) {
      const latencyMs = this.getLatencyMs(quote.ts);
      const fresh = latencyMs !== null && latencyMs >= 0 && latencyMs <= this.quoteStaleMs;
      this.store.recordQuoteQuality({ stale: !fresh, latencyMs });
      if (!fresh) {
        this.store.insertAlert(
          "warn",
          "quote_stale",
          `${source} quote stale ${quote.pair}@${quote.dex} ts=${quote.ts}`,
        );
        continue;
      }

      const anomaly = this.detectAnomaly(quote, medians.get(quote.pair) ?? null);
      if (anomaly) {
        this.markAnomaly(anomaly);
        continue;
      }

      this.anomalyStreak = 0;
      const pairDex = this.makePairDexKey(quote.pair, quote.dex);
      const tsMs = Date.parse(quote.ts);
      this.lastTsByPairDex.set(pairDex, tsMs);
      this.latestByPairDex.set(pairDex, quote);
      this.store.insertMarketSnapshot(quote);
      accepted.push(quote);
    }
    return accepted;
  }

  private detectAnomaly(quote: Quote, pairMedian: number | null): string | null {
    const pairDex = this.makePairDexKey(quote.pair, quote.dex);
    const tsMs = Date.parse(quote.ts);
    const prevTs = this.lastTsByPairDex.get(pairDex);
    if (!Number.isFinite(tsMs)) {
      return `invalid timestamp for ${quote.pair}@${quote.dex}`;
    }
    if (prevTs !== undefined && tsMs < prevTs) {
      return `timestamp rollback ${quote.pair}@${quote.dex} ${quote.ts}`;
    }
    if (prevTs !== undefined && tsMs === prevTs) {
      return `duplicate quote ${quote.pair}@${quote.dex} ts=${quote.ts}`;
    }

    const midpoint = (quote.bid + quote.ask) / 2;
    if (
      pairMedian !== null &&
      pairMedian > 0 &&
      Number.isFinite(midpoint) &&
      Math.abs(midpoint - pairMedian) / pairMedian > this.anomalyDeviationPct
    ) {
      const deviationPct = (Math.abs(midpoint - pairMedian) / pairMedian) * 100;
      return `price anomaly ${quote.pair}@${quote.dex} deviation=${deviationPct.toFixed(2)}%`;
    }
    return null;
  }

  private markAnomaly(message: string): void {
    this.anomalyStreak += 1;
    this.store.insertAlert("warn", "quote_anomaly", message);
    if (this.anomalyStreak >= this.anomalyStreakAlertThreshold) {
      this.store.insertAlert(
        "error",
        "quote_anomaly_streak",
        `continuous quote anomalies=${this.anomalyStreak}`,
      );
    }
  }

  private buildPairMedians(candidates: Quote[]): Map<string, number | null> {
    const byPair = new Map<string, number[]>();
    for (const candidate of candidates) {
      const midpoint = (candidate.bid + candidate.ask) / 2;
      if (!Number.isFinite(midpoint) || midpoint <= 0) {
        continue;
      }
      const arr = byPair.get(candidate.pair) ?? [];
      arr.push(midpoint);
      byPair.set(candidate.pair, arr);
    }
    for (const [pairDex, quote] of this.latestByPairDex.entries()) {
      const [pair] = pairDex.split("|");
      const midpoint = (quote.bid + quote.ask) / 2;
      if (!Number.isFinite(midpoint) || midpoint <= 0) {
        continue;
      }
      const arr = byPair.get(pair) ?? [];
      arr.push(midpoint);
      byPair.set(pair, arr);
    }

    const result = new Map<string, number | null>();
    for (const [pair, mids] of byPair.entries()) {
      result.set(pair, median(mids));
    }
    return result;
  }

  private getLatestQuotes(pair: string, dexes: string[]): Quote[] {
    const quotes: Quote[] = [];
    for (const dex of dexes) {
      const quote = this.latestByPairDex.get(this.makePairDexKey(pair, dex));
      if (quote) {
        quotes.push(quote);
      }
    }
    return quotes;
  }

  private isFresh(quote: Quote): boolean {
    const latencyMs = this.getLatencyMs(quote.ts);
    return latencyMs !== null && latencyMs >= 0 && latencyMs <= this.quoteStaleMs;
  }

  private getLatencyMs(ts: string): number | null {
    const tsMs = Date.parse(ts);
    if (!Number.isFinite(tsMs)) {
      return null;
    }
    return Math.max(0, Date.now() - tsMs);
  }

  private makePairDexKey(pair: string, dex: string): string {
    return `${pair}|${dex}`;
  }
}
