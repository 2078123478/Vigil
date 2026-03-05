import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AlphaEngine } from "../src/skills/alphaos/engine/alpha-engine";
import { RiskEngine } from "../src/skills/alphaos/runtime/risk-engine";
import { Simulator } from "../src/skills/alphaos/runtime/simulator";
import { StateStore } from "../src/skills/alphaos/runtime/state-store";
import type { SimulationResult, StrategyPlugin } from "../src/skills/alphaos/types";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("AlphaEngine opportunity dedup", () => {
  it("suppresses duplicate spread execution within dedup TTL", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "alphaos-engine-dedup-"));
    const store = new StateStore(tempDir);

    let scans = 0;
    const plugin: StrategyPlugin = {
      id: "dex-arbitrage",
      version: "1.0.0",
      async scan() {
        scans += 1;
        if (scans > 4) {
          return [];
        }

        return [
          {
            id: `opp-dedup-${scans}`,
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

    let executeCalls = 0;
    const executor = {
      async execute(_mode: "paper" | "live", _plan: unknown, simulation: SimulationResult) {
        executeCalls += 1;
        return {
          success: true,
          txHash: `paper-${executeCalls}`,
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
        startMode: "paper",
        liveEnabled: false,
        autoPromoteToLive: false,
        opportunityDedupTtlMs: 10_000,
        opportunityDedupMinEdgeDeltaBps: 2,
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
      new Simulator({
        slippageBps: 12,
        takerFeeBps: 1,
        gasUsdDefault: 0,
        mevPenaltyBps: 0,
        liquidityUsdDefault: 1_000_000,
        volatilityDefault: 0,
        avgLatencyMsDefault: 0,
      }),
      new RiskEngine({
        minNetEdgeBpsPaper: 1,
        minNetEdgeBpsLive: 1,
        maxTradePctBalance: 0.5,
        maxDailyLossPct: 0.015,
        maxConsecutiveFailures: 3,
      }),
      store,
      { async publish() {}, async flushOutbox() {} } as never,
      executor as never,
    );

    engine.start();
    await sleep(180);
    engine.stop();

    const trades = store.listTrades(10) as Array<{ tx_hash: string }>;
    const opportunities = store.listOpportunities(10) as Array<{ id: string }>;
    expect(executeCalls).toBe(1);
    expect(trades.length).toBe(1);
    expect(opportunities.length).toBe(1);

    store.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
