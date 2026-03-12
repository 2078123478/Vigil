import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AlphaEngine } from "../src/skills/alphaos/engine/alpha-engine";
import { RiskEngine } from "../src/skills/alphaos/runtime/risk-engine";
import { Simulator } from "../src/skills/alphaos/runtime/simulator";
import { StateStore } from "../src/skills/alphaos/runtime/state-store";
import type { Quote, SimulationResult, StrategyPlugin } from "../src/skills/alphaos/types";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("AlphaEngine degraded-to-paper", () => {
  it("degrades live restricted trade to paper execution", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "alphaos-engine-"));
    const store = new StateStore(tempDir);

    let scanned = false;
    const plugin: StrategyPlugin = {
      id: "dex-arbitrage",
      version: "1.0.0",
      async scan() {
        if (scanned) {
          return [];
        }
        scanned = true;
        return [
          {
            id: "opp-live-1",
            strategyId: "dex-arbitrage",
            pair: "ETH/USDC",
            buyDex: "a",
            sellDex: "b",
            buyPrice: 100,
            sellPrice: 102,
            grossEdgeBps: 200,
            detectedAt: new Date().toISOString(),
          },
        ];
      },
      async evaluate(opportunity) {
        return { accepted: true, reason: "ok", opportunity };
      },
      async plan(input) {
        return {
          opportunityId: input.opportunity.id,
          strategyId: "dex-arbitrage",
          pair: input.opportunity.pair,
          buyDex: input.opportunity.buyDex,
          sellDex: input.opportunity.sellDex,
          buyPrice: input.opportunity.buyPrice,
          sellPrice: input.opportunity.sellPrice,
          notionalUsd: 50,
        };
      },
    };

    const marketWatch = {
      async fetch() {
        return [
          { pair: "ETH/USDC", dex: "a", bid: 99.8, ask: 100, gasUsd: 1, ts: new Date().toISOString() },
          { pair: "ETH/USDC", dex: "b", bid: 102, ask: 102.2, gasUsd: 1, ts: new Date().toISOString() },
        ];
      },
    };

    const notifier = {
      async publish() {
        return;
      },
      async flushOutbox() {
        return;
      },
    };

    const logger = {
      info() {
        return;
      },
      error() {
        return;
      },
    };

    const executor = {
      async execute(mode: "paper" | "live", _plan: unknown, simulation: SimulationResult) {
        if (mode === "live") {
          return {
            success: false,
            txHash: "",
            status: "failed" as const,
            grossUsd: 0,
            feeUsd: 0,
            netUsd: 0,
            errorType: "permission_denied" as const,
            error: "403 whitelist required",
          };
        }
        return {
          success: true,
          txHash: "paper-tx-1",
          status: "confirmed" as const,
          grossUsd: simulation.grossUsd,
          feeUsd: simulation.feeUsd,
          netUsd: simulation.netUsd,
        };
      },
    };

    const engine = new AlphaEngine(
      {
        id: "alphaos",
        version: "0.3.0",
        description: "test",
        strategyIds: ["dex-arbitrage"],
      },
      [plugin],
      {
        intervalMs: 25,
        pair: "ETH/USDC",
        dexes: ["a", "b"],
        startMode: "live",
        liveEnabled: true,
        autoPromoteToLive: false,
        paperStartingBalanceUsd: 1000,
        liveBalanceUsd: 1000,
        riskPolicy: {
          minNetEdgeBpsPaper: 1,
          minNetEdgeBpsLive: 1,
          maxTradePctBalance: 0.5,
          maxDailyLossPct: 0.015,
          maxConsecutiveFailures: 3,
        },
      },
      logger as never,
      marketWatch as never,
      new Simulator({ slippageBps: 1, takerFeeBps: 1, gasUsdDefault: 0.1 }),
      new RiskEngine({
        minNetEdgeBpsPaper: 1,
        minNetEdgeBpsLive: 1,
        maxTradePctBalance: 0.5,
        maxDailyLossPct: 0.015,
        maxConsecutiveFailures: 3,
      }),
      store,
      notifier as never,
      executor as never,
    );

    engine.start();
    await sleep(120);
    engine.stop();

    const opps = store.listOpportunities(10) as Array<{ id: string; status: string }>;
    const trades = store.listTrades(10) as Array<{ mode: string; tx_hash: string }>;

    expect(opps.some((o) => o.id === "opp-live-1" && o.status === "degraded_to_paper")).toBe(true);
    expect(trades.some((t) => t.mode === "paper")).toBe(true);
    expect(trades.some((t) => t.mode === "live")).toBe(false);

    store.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("uses dynamic balance from StateStore cumulative pnl when sizing plan", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "alphaos-engine-balance-"));
    const store = new StateStore(tempDir);
    const now = new Date().toISOString();
    store.ensureBalanceBaseline("paper", 100);
    store.insertOpportunity(
      {
        id: "seed-opp",
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
      "seed-opp",
      "paper",
      {
        success: true,
        txHash: "seed-tx",
        status: "confirmed",
        grossUsd: 120,
        feeUsd: 20,
        netUsd: 100,
      },
      now,
    );

    let scanned = false;
    const plugin: StrategyPlugin = {
      id: "dex-arbitrage",
      version: "1.0.0",
      async scan() {
        if (scanned) {
          return [];
        }
        scanned = true;
        return [
          {
            id: "opp-balance-1",
            strategyId: "dex-arbitrage",
            pair: "ETH/USDC",
            buyDex: "a",
            sellDex: "b",
            buyPrice: 100,
            sellPrice: 102,
            grossEdgeBps: 200,
            detectedAt: new Date().toISOString(),
          },
        ];
      },
      async evaluate(opportunity) {
        return { accepted: true, reason: "ok", opportunity };
      },
      async plan(input) {
        return {
          opportunityId: input.opportunity.id,
          strategyId: "dex-arbitrage",
          pair: input.opportunity.pair,
          buyDex: input.opportunity.buyDex,
          sellDex: input.opportunity.sellDex,
          buyPrice: input.opportunity.buyPrice,
          sellPrice: input.opportunity.sellPrice,
          notionalUsd: 150,
        };
      },
    };

    const marketWatch = {
      async fetch() {
        return [
          { pair: "ETH/USDC", dex: "a", bid: 99.8, ask: 100, gasUsd: 0, ts: new Date().toISOString() },
          { pair: "ETH/USDC", dex: "b", bid: 102, ask: 102.2, gasUsd: 0, ts: new Date().toISOString() },
        ];
      },
    };
    const notifier = {
      async publish() {
        return;
      },
      async flushOutbox() {
        return;
      },
    };
    const logger = {
      info() {
        return;
      },
      error() {
        return;
      },
    };
    const executor = {
      async execute(_mode: "paper" | "live", _plan: unknown, simulation: SimulationResult) {
        return {
          success: true,
          txHash: "paper-tx-balance",
          status: "confirmed" as const,
          grossUsd: simulation.grossUsd,
          feeUsd: simulation.feeUsd,
          netUsd: simulation.netUsd,
        };
      },
    };

    const engine = new AlphaEngine(
      {
        id: "alphaos",
        version: "0.3.0",
        description: "test",
        strategyIds: ["dex-arbitrage"],
      },
      [plugin],
      {
        intervalMs: 20,
        pair: "ETH/USDC",
        dexes: ["a", "b"],
        startMode: "paper",
        liveEnabled: false,
        autoPromoteToLive: false,
        paperStartingBalanceUsd: 100,
        liveBalanceUsd: 100,
        riskPolicy: {
          minNetEdgeBpsPaper: 1,
          minNetEdgeBpsLive: 1,
          maxTradePctBalance: 1,
          maxDailyLossPct: 0.015,
          maxConsecutiveFailures: 3,
        },
      },
      logger as never,
      marketWatch as never,
      new Simulator({ slippageBps: 0, takerFeeBps: 0, gasUsdDefault: 0 }),
      new RiskEngine({
        minNetEdgeBpsPaper: 1,
        minNetEdgeBpsLive: 1,
        maxTradePctBalance: 1,
        maxDailyLossPct: 0.015,
        maxConsecutiveFailures: 3,
      }),
      store,
      notifier as never,
      executor as never,
    );

    engine.start();
    await sleep(120);
    engine.stop();

    const simulations = (store as unknown as { alphaDb: { prepare: (sql: string) => { all: (...args: unknown[]) => Array<{ input_json: string }> } } }).alphaDb
      .prepare("SELECT input_json FROM simulations ORDER BY created_at DESC LIMIT 1")
      .all() as Array<{ input_json: string }>;
    expect(simulations.length).toBe(1);
    expect(simulations[0]?.input_json).toContain("\"notionalUsd\":150");

    store.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("blocks live mode promotion when permission failure stats are present", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "alphaos-engine-gate-"));
    const store = new StateStore(tempDir);
    store.insertAlert("warn", "live_permission_degraded", "permission denied");

    const plugin: StrategyPlugin = {
      id: "dex-arbitrage",
      version: "1.0.0",
      async scan() {
        return [];
      },
      async evaluate(opportunity) {
        return { accepted: false, reason: "skip", opportunity };
      },
      async plan() {
        return null;
      },
    };

    store.insertSimulation({
      opportunityId: "seed-sim",
      mode: "paper",
      inputJson: JSON.stringify({ test: 1 }),
      resultJson: JSON.stringify({ netUsd: 10, pass: true }),
      createdAt: new Date().toISOString(),
    });

    const engine = new AlphaEngine(
      {
        id: "alphaos",
        version: "0.3.0",
        description: "test",
        strategyIds: ["dex-arbitrage"],
      },
      [plugin],
      {
        intervalMs: 1000,
        pair: "ETH/USDC",
        dexes: ["a", "b"],
        startMode: "paper",
        liveEnabled: true,
        autoPromoteToLive: false,
        paperStartingBalanceUsd: 1000,
        liveBalanceUsd: 1000,
        riskPolicy: {
          minNetEdgeBpsPaper: 1,
          minNetEdgeBpsLive: 1,
          maxTradePctBalance: 1,
          maxDailyLossPct: 0.015,
          maxConsecutiveFailures: 3,
        },
      },
      { info() {}, error() {} } as never,
      { async fetch() { return []; } } as never,
      new Simulator({ slippageBps: 0, takerFeeBps: 0, gasUsdDefault: 0 }),
      new RiskEngine({
        minNetEdgeBpsPaper: 1,
        minNetEdgeBpsLive: 1,
        maxTradePctBalance: 1,
        maxDailyLossPct: 0.015,
        maxConsecutiveFailures: 3,
      }),
      store,
      { async publish() {}, async flushOutbox() {} } as never,
      {
        async execute() {
          return {
            success: true,
            txHash: "paper",
            status: "confirmed" as const,
            grossUsd: 0,
            feeUsd: 0,
            netUsd: 0,
          };
        },
      } as never,
    );

    const response = engine.requestMode("live");
    expect(response.ok).toBe(false);
    expect(response.reasons.some((reason) => reason.includes("permission failures"))).toBe(true);

    store.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("applies freshness gate again in engine consumption", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "alphaos-engine-fresh-"));
    const store = new StateStore(tempDir);
    let seenQuotes: Quote[] = [];

    const plugin: StrategyPlugin = {
      id: "dex-arbitrage",
      version: "1.0.0",
      async scan(ctx) {
        seenQuotes = ctx.quotes;
        return [];
      },
      async evaluate(opportunity) {
        return { accepted: false, reason: "skip", opportunity };
      },
      async plan() {
        return null;
      },
    };

    const staleTs = new Date(Date.now() - 5000).toISOString();
    const freshTs = new Date().toISOString();
    const marketWatch = {
      async fetch() {
        return [
          { pair: "ETH/USDC", dex: "a", bid: 100, ask: 100.1, gasUsd: 1, ts: staleTs },
          { pair: "ETH/USDC", dex: "b", bid: 101, ask: 101.1, gasUsd: 1, ts: freshTs },
        ];
      },
    };

    const engine = new AlphaEngine(
      {
        id: "alphaos",
        version: "0.3.0",
        description: "test",
        strategyIds: ["dex-arbitrage"],
      },
      [plugin],
      {
        intervalMs: 1000,
        pair: "ETH/USDC",
        dexes: ["a", "b"],
        startMode: "paper",
        liveEnabled: false,
        autoPromoteToLive: false,
        quoteStaleMs: 1000,
        paperStartingBalanceUsd: 1000,
        liveBalanceUsd: 1000,
        riskPolicy: {
          minNetEdgeBpsPaper: 1,
          minNetEdgeBpsLive: 1,
          maxTradePctBalance: 0.5,
          maxDailyLossPct: 0.015,
          maxConsecutiveFailures: 3,
        },
      },
      { info() {}, error() {} } as never,
      marketWatch as never,
      new Simulator({ slippageBps: 1, takerFeeBps: 1, gasUsdDefault: 0.1 }),
      new RiskEngine({
        minNetEdgeBpsPaper: 1,
        minNetEdgeBpsLive: 1,
        maxTradePctBalance: 0.5,
        maxDailyLossPct: 0.015,
        maxConsecutiveFailures: 3,
      }),
      store,
      { async publish() {}, async flushOutbox() {} } as never,
      {
        async execute() {
          return {
            success: true,
            txHash: "paper",
            status: "confirmed" as const,
            grossUsd: 0,
            feeUsd: 0,
            netUsd: 0,
          };
        },
      } as never,
    );

    engine.start();
    await sleep(80);
    engine.stop();

    expect(seenQuotes.length).toBe(1);
    expect(seenQuotes[0]?.dex).toBe("b");
    expect(store.getTodayMetrics().staleQuotes).toBe(1);

    store.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("triggers circuit breaker on successful trades that breach daily loss", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "alphaos-engine-loss-break-"));
    const store = new StateStore(tempDir);
    store.insertSimulation({
      opportunityId: "seed-live-pass",
      mode: "paper",
      inputJson: JSON.stringify({ seeded: true }),
      resultJson: JSON.stringify({ netUsd: 25, pass: true }),
      createdAt: new Date().toISOString(),
    });

    let scanned = false;
    const plugin: StrategyPlugin = {
      id: "dex-arbitrage",
      version: "1.0.0",
      async scan() {
        if (scanned) {
          return [];
        }
        scanned = true;
        return [
          {
            id: "opp-loss-break",
            strategyId: "dex-arbitrage",
            pair: "ETH/USDC",
            buyDex: "a",
            sellDex: "b",
            buyPrice: 100,
            sellPrice: 102,
            grossEdgeBps: 200,
            detectedAt: new Date().toISOString(),
          },
        ];
      },
      async evaluate(opportunity) {
        return { accepted: true, reason: "ok", opportunity };
      },
      async plan(input) {
        return {
          opportunityId: input.opportunity.id,
          strategyId: "dex-arbitrage",
          pair: input.opportunity.pair,
          buyDex: input.opportunity.buyDex,
          sellDex: input.opportunity.sellDex,
          buyPrice: input.opportunity.buyPrice,
          sellPrice: input.opportunity.sellPrice,
          notionalUsd: 100,
        };
      },
    };

    const marketWatch = {
      async fetch() {
        return [
          { pair: "ETH/USDC", dex: "a", bid: 99.8, ask: 100, gasUsd: 0, ts: new Date().toISOString() },
          { pair: "ETH/USDC", dex: "b", bid: 102, ask: 102.2, gasUsd: 0, ts: new Date().toISOString() },
        ];
      },
    };

    const engine = new AlphaEngine(
      {
        id: "alphaos",
        version: "0.3.0",
        description: "test",
        strategyIds: ["dex-arbitrage"],
      },
      [plugin],
      {
        intervalMs: 20,
        pair: "ETH/USDC",
        dexes: ["a", "b"],
        startMode: "live",
        liveEnabled: true,
        autoPromoteToLive: false,
        paperStartingBalanceUsd: 1000,
        liveBalanceUsd: 1000,
        riskPolicy: {
          minNetEdgeBpsPaper: 1,
          minNetEdgeBpsLive: 1,
          maxTradePctBalance: 1,
          maxDailyLossPct: 0.01,
          maxConsecutiveFailures: 3,
        },
      },
      { info() {}, error() {} } as never,
      marketWatch as never,
      new Simulator({ slippageBps: 0, takerFeeBps: 0, gasUsdDefault: 0 }),
      new RiskEngine({
        minNetEdgeBpsPaper: 1,
        minNetEdgeBpsLive: 1,
        maxTradePctBalance: 1,
        maxDailyLossPct: 0.01,
        maxConsecutiveFailures: 3,
      }),
      store,
      { async publish() {}, async flushOutbox() {} } as never,
      {
        async execute() {
          return {
            success: true,
            txHash: "live-loss-tx",
            status: "confirmed" as const,
            grossUsd: 5,
            feeUsd: 30,
            netUsd: -25,
          };
        },
      } as never,
    );

    engine.start();
    await sleep(120);
    engine.stop();

    expect(engine.getCurrentMode()).toBe("paper");
    expect(store.listAlerts(10).some((alert) => alert.eventType === "circuit_breaker")).toBe(true);

    store.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
