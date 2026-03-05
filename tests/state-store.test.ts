import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { StateStore } from "../src/skills/alphaos/runtime/state-store";

function createStore(prefix: string): { dir: string; store: StateStore } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, store: new StateStore(dir) };
}

describe("StateStore P0 safety", () => {
  it("rolls back trade insert when pnl update fails inside transaction", () => {
    const { dir, store } = createStore("alphaos-state-");
    const db = (store as unknown as { alphaDb: Database.Database }).alphaDb;
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS test_abort_pnl_insert
      BEFORE INSERT ON pnl_daily
      BEGIN
        SELECT RAISE(ABORT, 'forced pnl failure');
      END;
    `);

    store.insertOpportunity(
      {
        id: "opp-rollback",
        strategyId: "dex-arbitrage",
        pair: "ETH/USDC",
        buyDex: "a",
        sellDex: "b",
        buyPrice: 100,
        sellPrice: 101,
        grossEdgeBps: 100,
        detectedAt: new Date().toISOString(),
      },
      1,
      1,
      "executed",
    );

    expect(() =>
      store.insertTrade(
        "opp-rollback",
        "paper",
        {
          success: true,
          txHash: "tx-rollback",
          status: "confirmed",
          grossUsd: 4,
          feeUsd: 1,
          netUsd: 3,
        },
        new Date().toISOString(),
      ),
    ).toThrow(/forced pnl failure/);

    expect((store.listTrades(10) as unknown[]).length).toBe(0);

    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("claims whale signals atomically through pending -> processing -> consumed/ignored", () => {
    const { dir, store } = createStore("alphaos-state-");
    const first = store.insertWhaleSignal({
      wallet: "0xabc",
      token: "ETH",
      side: "buy",
      sizeUsd: 20000,
      confidence: 0.9,
    });
    const second = store.insertWhaleSignal({
      wallet: "0xdef",
      token: "SOL",
      side: "sell",
      sizeUsd: 10000,
      confidence: 0.8,
    });

    const claimed = store.claimPendingWhaleSignals(10);
    expect(claimed.length).toBe(2);
    expect(claimed.every((signal) => signal.status === "processing")).toBe(true);
    expect(store.claimPendingWhaleSignals(10).length).toBe(0);

    store.updateWhaleSignalStatus(first, "consumed");
    store.updateWhaleSignalStatus(second, "ignored");

    expect(store.listWhaleSignals("processing", 10).length).toBe(0);
    expect(store.listWhaleSignals("consumed", 10).length).toBe(1);
    expect(store.listWhaleSignals("ignored", 10).length).toBe(1);

    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("computes current balance from baseline plus cumulative pnl", () => {
    const { dir, store } = createStore("alphaos-state-");
    const now = new Date().toISOString();
    store.ensureBalanceBaseline("paper", 1000);

    store.insertOpportunity(
      {
        id: "opp-bal-1",
        strategyId: "dex-arbitrage",
        pair: "ETH/USDC",
        buyDex: "a",
        sellDex: "b",
        buyPrice: 100,
        sellPrice: 101,
        grossEdgeBps: 100,
        detectedAt: now,
      },
      1,
      1,
      "executed",
    );
    store.insertTrade(
      "opp-bal-1",
      "paper",
      {
        success: true,
        txHash: "tx-bal-1",
        status: "confirmed",
        grossUsd: 12,
        feeUsd: 2,
        netUsd: 10,
      },
      now,
    );

    store.insertOpportunity(
      {
        id: "opp-bal-2",
        strategyId: "dex-arbitrage",
        pair: "ETH/USDC",
        buyDex: "a",
        sellDex: "b",
        buyPrice: 100,
        sellPrice: 100.5,
        grossEdgeBps: 50,
        detectedAt: now,
      },
      1,
      -1,
      "failed",
    );
    store.insertTrade(
      "opp-bal-2",
      "paper",
      {
        success: false,
        txHash: "tx-bal-2",
        status: "failed",
        grossUsd: 0,
        feeUsd: 5,
        netUsd: -5,
      },
      now,
    );

    expect(store.getCurrentBalance("paper")).toBe(1005);

    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("aggregates execution quality stats for risk gate inputs", () => {
    const { dir, store } = createStore("alphaos-state-");
    const now = new Date().toISOString();

    store.insertOpportunity(
      {
        id: "opp-quality-1",
        strategyId: "dex-arbitrage",
        pair: "ETH/USDC",
        buyDex: "a",
        sellDex: "b",
        buyPrice: 100,
        sellPrice: 101,
        grossEdgeBps: 100,
        detectedAt: now,
      },
      1,
      1,
      "rejected",
    );
    store.insertOpportunity(
      {
        id: "opp-quality-2",
        strategyId: "dex-arbitrage",
        pair: "ETH/USDC",
        buyDex: "a",
        sellDex: "b",
        buyPrice: 100,
        sellPrice: 101,
        grossEdgeBps: 100,
        detectedAt: now,
      },
      1,
      1,
      "executed",
    );

    store.insertTrade(
      "opp-quality-2",
      "live",
      {
        success: false,
        txHash: "tx-quality-1",
        status: "failed",
        grossUsd: 0,
        feeUsd: 1,
        netUsd: -1,
        errorType: "permission_denied",
        latencyMs: 6000,
        slippageDeviationBps: 90,
      },
      now,
    );
    store.insertAlert("warn", "live_permission_degraded", "permission denied");

    const stats = store.getExecutionQualityStats(24);
    expect(stats.permissionFailures).toBe(2);
    expect(stats.rejectRate).toBe(0.5);
    expect(stats.avgLatencyMs).toBe(6000);
    expect(stats.avgSlippageDeviationBps).toBe(90);

    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("aggregates market state stats from opportunity metadata", () => {
    const { dir, store } = createStore("alphaos-state-");
    const now = new Date().toISOString();

    store.insertOpportunity(
      {
        id: "opp-market-1",
        strategyId: "dex-arbitrage",
        pair: "ETH/USDC",
        buyDex: "a",
        sellDex: "b",
        buyPrice: 100,
        sellPrice: 101,
        grossEdgeBps: 100,
        detectedAt: now,
        metadata: { volatility: 0.1, liquidityUsd: 120_000, gasBuyUsd: 1, gasSellUsd: 2 },
      },
      1,
      1,
      "detected",
    );
    store.insertOpportunity(
      {
        id: "opp-market-2",
        strategyId: "dex-arbitrage",
        pair: "ETH/USDC",
        buyDex: "a",
        sellDex: "b",
        buyPrice: 100,
        sellPrice: 101,
        grossEdgeBps: 100,
        detectedAt: now,
        metadata: { volatility: 0.3, liquidityUsd: 80_000, gasBuyUsd: 3, gasSellUsd: 5 },
      },
      1,
      1,
      "detected",
    );

    const stats = store.getMarketStateStats(24);
    expect(stats.samples).toBe(2);
    expect(stats.volatility24h).toBeCloseTo(0.2, 6);
    expect(stats.gasP90Usd24h).toBeCloseTo(4.4, 6);
    expect(stats.liquidityMedianUsd24h).toBeCloseTo(100_000, 6);

    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("records stale quote count and average quote latency", () => {
    const { dir, store } = createStore("alphaos-state-");
    store.recordQuoteQuality({ stale: false, latencyMs: 100 });
    store.recordQuoteQuality({ stale: true, latencyMs: 400 });
    store.recordQuoteQuality({ stale: true, latencyMs: null });

    const metrics = store.getTodayMetrics();
    expect(metrics.staleQuotes).toBe(2);
    expect(metrics.avgQuoteLatencyMs).toBe(250);

    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
