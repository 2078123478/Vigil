import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { MarketWatch, type WsSocketLike } from "../src/skills/alphaos/runtime/market-watch";
import { StateStore } from "../src/skills/alphaos/runtime/state-store";
import type { Quote } from "../src/skills/alphaos/types";

function createStore(prefix: string): { dir: string; store: StateStore } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, store: new StateStore(dir) };
}

function countSnapshots(store: StateStore): number {
  const db = (store as unknown as { alphaDb: Database.Database }).alphaDb;
  const row = db.prepare("SELECT COUNT(1) AS count FROM market_snapshots").get() as { count: number };
  return row.count;
}

class FakeWebSocket implements WsSocketLike {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data?: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event?: { code?: number; reason?: string }) => void) | null = null;
  sent: string[] = [];

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1000, reason: "closed" });
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  emit(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  disconnect(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1006, reason: "drop" });
  }
}

describe("MarketWatch P0 week3", () => {
  it("uses websocket stream with heartbeat/reconnect and falls back to polling", async () => {
    vi.useFakeTimers();
    const { dir, store } = createStore("alphaos-market-watch-");
    let pollCalls = 0;
    const client = {
      async getQuotes(pair: string, dexes: string[]): Promise<Quote[]> {
        pollCalls += 1;
        const ts = new Date().toISOString();
        return dexes.map((dex, index) => ({
          pair,
          dex,
          bid: 100 + index,
          ask: 100.1 + index,
          gasUsd: 1,
          ts,
        }));
      },
    };

    const sockets: FakeWebSocket[] = [];
    const watch = new MarketWatch(client as never, store, {
      wsEnabled: true,
      wsUrl: "wss://quotes.example/ws",
      wsReconnectMs: 20,
      wsHeartbeatMs: 10,
      quoteStaleMs: 5000,
      wsFactory: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });

    const first = await watch.fetch("ETH/USDC", ["a", "b"]);
    expect(first.length).toBe(2);
    expect(pollCalls).toBe(1);
    expect(sockets.length).toBe(1);

    sockets[0].open();
    sockets[0].emit({
      quotes: [
        { pair: "ETH/USDC", dex: "a", bid: 99.9, ask: 100, gasUsd: 1, ts: new Date().toISOString() },
        { pair: "ETH/USDC", dex: "b", bid: 101, ask: 101.1, gasUsd: 1, ts: new Date().toISOString() },
      ],
    });

    await vi.advanceTimersByTimeAsync(1010);
    const sentPayloads = sockets[0].sent.join("\n");
    expect(sentPayloads.includes('"type":"subscribe"')).toBe(true);
    expect(sentPayloads.includes('"type":"ping"')).toBe(true);

    const second = await watch.fetch("ETH/USDC", ["a", "b"]);
    expect(second.length).toBe(2);
    expect(pollCalls).toBe(1);

    sockets[0].disconnect();
    await vi.advanceTimersByTimeAsync(120);
    expect(sockets.length).toBe(2);

    sockets[1].open();
    sockets[1].emit({
      quote: { pair: "ETH/USDC", dex: "a", bid: 103, ask: 103.2, gasUsd: 1, ts: new Date().toISOString() },
    });

    const third = await watch.fetch("ETH/USDC", ["a"]);
    expect(third.length).toBe(1);
    expect(third[0]?.ask).toBe(103.2);
    expect(pollCalls).toBe(1);

    watch.close();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it("drops stale quotes before storage and strategy consumption", async () => {
    const { dir, store } = createStore("alphaos-market-watch-");
    const staleTs = new Date(Date.now() - 10_000).toISOString();
    const freshTs = new Date().toISOString();

    const client = {
      async getQuotes(): Promise<Quote[]> {
        return [
          { pair: "ETH/USDC", dex: "a", bid: 99, ask: 100, gasUsd: 1, ts: staleTs },
          { pair: "ETH/USDC", dex: "b", bid: 101, ask: 101.1, gasUsd: 1, ts: freshTs },
        ];
      },
    };

    const watch = new MarketWatch(client as never, store, { quoteStaleMs: 1000 });
    const quotes = await watch.fetch("ETH/USDC", ["a", "b"]);

    expect(quotes.length).toBe(1);
    expect(quotes[0]?.dex).toBe("b");
    expect(countSnapshots(store)).toBe(1);

    const metrics = store.getTodayMetrics();
    expect(metrics.staleQuotes).toBe(1);
    expect(metrics.avgQuoteLatencyMs).toBeGreaterThan(0);

    watch.close();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("detects anomalies and raises streak alert", async () => {
    const { dir, store } = createStore("alphaos-market-watch-");
    const t1Ms = Date.now();
    const t2Ms = t1Ms + 1000;
    const t0Ms = t1Ms - 1000;
    const t1 = new Date(t1Ms).toISOString();
    const t2 = new Date(t2Ms).toISOString();
    const t0 = new Date(t0Ms).toISOString();
    let call = 0;

    const client = {
      async getQuotes(): Promise<Quote[]> {
        call += 1;
        if (call === 1) {
          return [
            { pair: "ETH/USDC", dex: "a", bid: 100, ask: 100.1, gasUsd: 1, ts: t1 },
            { pair: "ETH/USDC", dex: "b", bid: 101, ask: 101.1, gasUsd: 1, ts: t1 },
          ];
        }
        return [
          { pair: "ETH/USDC", dex: "a", bid: 100, ask: 100.1, gasUsd: 1, ts: t1 },
          { pair: "ETH/USDC", dex: "b", bid: 101, ask: 101.1, gasUsd: 1, ts: t0 },
          { pair: "ETH/USDC", dex: "c", bid: 500, ask: 500.2, gasUsd: 1, ts: t2 },
        ];
      },
    };

    const watch = new MarketWatch(client as never, store, {
      quoteStaleMs: 60_000,
      anomalyStreakAlertThreshold: 2,
    });

    const first = await watch.fetch("ETH/USDC", ["a", "b"]);
    expect(first.length).toBe(2);

    const second = await watch.fetch("ETH/USDC", ["a", "b", "c"]);
    expect(second.length).toBe(0);
    expect(countSnapshots(store)).toBe(2);

    const alerts = store.listAlerts(20);
    const anomalyAlerts = alerts.filter((item) => item.eventType === "quote_anomaly");
    expect(anomalyAlerts.length).toBeGreaterThanOrEqual(3);
    expect(alerts.some((item) => item.eventType === "quote_anomaly_streak")).toBe(true);

    watch.close();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
